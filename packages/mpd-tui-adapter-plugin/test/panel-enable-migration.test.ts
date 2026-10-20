// T1 of the frozen contract (`fix/sidebar-panel-trio`): the keeper's STALE-DEFAULT MIGRATION.
//
// THE DEFECT THIS FILE PINS. A 0.13.0-era `/settings` save materialized `todo,jobs,agents` into the
// user's profile layer, and a user layer OUTRANKS the schema default — so the five builtins 0.14.0
// added (`info,trajectory,workspace,btw,companion`) never reach the sidebar, while the keeper's own
// merge (`kept ∪ added`) faithfully preserved the stale pin. The migration answers exactly that list
// with the CURRENT host's default ∪ our ids, read live from the host module, and leaves every other
// list — a custom one included — byte-identical to before.
//
// WHY THE ARMS LIVE IN THIS PACKAGE: the rule is the adapter's (the ONE file allowed to reach host
// internals, AGENTS.md §6), and every arm below drives the SAME public surface the mounted row uses:
// `probeHostPrefs` for the contact, `stalePanelDefaultResidue` / `mergePanelEnableIds` for the pure
// decision, and `createPanelEnableKeeper` for both repair paths (the change feed and the ladder).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  HOST_PREFS_MODULE,
  KNOWN_STALE_PANEL_DEFAULTS,
  PANEL_CSV_SELF_HEAL_SINCE,
  PANEL_KEEPER_LADDER_MS,
  createPanelEnableKeeper,
  hostOwnsPanelCsv,
  hostSelfHealsPanelCsv,
  hostVersionAtLeast,
  mergePanelEnableIds,
  probeHostPrefs,
  stalePanelDefaultResidue,
  type TuiHostPrefsLike,
} from "../src/index.js"

/** The 0.13.0 default a stale profile layer carries: the ONE known stale default, spelled literally. */
const STALE_PIN = "todo,jobs,agents"

/** The 0.14.0 default this machine's host ships, as the live module exports it. */
const HOST_DEFAULT = "todo,jobs,agents,info,trajectory,workspace,btw,companion"

/** The ids this bundle registers on a boot, in registration order (the host's own `act<N>` fallback). */
const OURS: readonly string[] = ["act1:team", "act1:workmate"]

/** The CSV a migrated store must hold: the host default in the host's order, then our ids. */
const MIGRATED = `${HOST_DEFAULT},${OURS.join(",")}`

/**
 * A controllable clock for the keeper's bounded ladder: the arm owns the timing.
 * @returns the schedule function, the delays it was asked for, and a driver for one tick.
 */
function fakeClock(): {
  readonly delays: number[]
  readonly schedule: (run: () => void, delayMs: number) => () => void
  runNext: () => Promise<void>
} {
  /** The delays the keeper asked to be woken after, in order. */
  const delays: number[] = []
  /** The pending ticks, in scheduling order. */
  const pending: (() => void)[] = []
  return {
    delays,
    /** Schedules one tick and hands back its canceller; see {@link PanelEnableKeeperOptions.schedule}. */
    schedule: (run: () => void, delayMs: number): (() => void) => {
      delays.push(delayMs)
      pending.push(run)
      return (): void => {
        /** Where this tick still sits in the queue, or -1 when it has already run. */
        const at = pending.indexOf(run)
        if (at >= 0) pending.splice(at, 1)
      }
    },
    /** Fire the next pending tick and let the keeper's promise chain settle. */
    runNext: async (): Promise<void> => {
      /** The tick to run; an exhausted ladder runs nothing. */
      const run = pending.shift()
      run?.()
      // The tick's body is `loadPrefs().then(...)`: a few microtask turns are enough for it to land.
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    },
  }
}

/**
 * The host's live-setting double, with `createLiveSetting`'s own semantics.
 *
 * Read from the host module rather than invented: `apply` normalizes, stores, and notifies every
 * listener ONLY when the value actually CHANGED. The migration arms below depend on that conditional
 * notification — the keeper's own write must NOT re-enter its decision — so a double that always
 * notified would test a different store.
 * @param initial - the CSV the store holds before anything is applied.
 * @param feed - true to expose the host's change feed (the 0.14.0 shape); false models a build
 *   without one, which is the ladder's degradation case.
 * @returns the store, every CSV applied through it, and a driver for the host's own rewrite.
 */
function fakeStore(initial: string, feed: boolean = false): {
  readonly store: TuiHostPrefsLike
  readonly applied: string[]
  readonly csv: () => string
  readonly listeners: () => number
  readonly hostApply: (value: string) => void
} {
  /** The CSV the store holds. */
  let csv = initial
  /** Every value applied through the store, the host's rewrites included. */
  const applied: string[] = []
  /** The store's live listeners — the keeper's one subscription, while it holds one. */
  const listeners = new Set<() => void>()
  /** One apply, exactly as the host's `createLiveSetting` performs it. */
  const applyValue = (value: string): void => {
    applied.push(value)
    if (value === csv) return
    csv = value
    for (const listener of [...listeners]) listener()
  }
  return {
    store: {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => {
        applyValue(String(value))
        return csv
      },
      ...(feed
        ? {
            subscribeSidePanelPanels: (listener: () => void): unknown => {
              listeners.add(listener)
              return (): void => {
                listeners.delete(listener)
              }
            },
          }
        : {}),
    },
    applied,
    csv: (): string => csv,
    /** How many listeners the store still holds, which is how a stand-down is observed. */
    listeners: (): number => listeners.size,
    // THE HOST'S OWN REWRITE (`applySidePanelPanels(config.sidePanel?.panels)`), named apart so an arm
    // can say who wrote — which is what makes "the keeper wrote exactly once" assertable.
    hostApply: (value: string): void => applyValue(value),
  }
}

/**
 * Stage a host install carrying a display-prefs module, the layout {@link probeHostPrefs} probes for.
 * @param body - the module source; the store members are always present, the default export is the
 *   caller's to include or omit (an omitted one is exactly the "unreadable host default" case).
 * @returns the staged root, and its own temporary parent to remove afterwards.
 */
function stagePrefsHost(body: string): { readonly root: string; readonly parent: string } {
  /** The throwaway parent every staged root lives under. */
  const parent = mkdtempSync(join(tmpdir(), "mpd-prefs-migration-"))
  mkdirSync(join(parent, "lib", "types"), { recursive: true })
  writeFileSync(join(parent, HOST_PREFS_MODULE), body)
  return { root: parent, parent }
}

/** The store members every staged host carries, so a probe binds the module whatever else it exports. */
const STORE_MEMBERS = "export const getSidePanelPanels = () => 'todo,jobs,agents'\nexport const applySidePanelPanels = (v) => v\n"

/**
 * The INSTALLED DSH-TUI package root, resolved from the launcher on `PATH`.
 *
 * Resolved rather than hardcoded for the same reason `panel-visibility.test.ts` resolves it: the arm it
 * serves is a statement about the host this machine actually launches. An absent launcher throws — a
 * skip would be a vacuous pass on the one clause that arm exists for.
 * @returns the host package's absolute root directory.
 */
function installedHostRoot(): string {
  /** The launcher's path on `PATH`, or null when the host is not installed at all. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: the live host-default arm cannot be vacuous")
  // PORTABLE resolution (win32 shim vs POSIX symlink). The `dirname(dirname(readlink -f))` guess this
  // replaced answered `%APPDATA%\Roaming` on win32 — MEASURED 2026-10-12: the whole file died with
  // `Cannot find module '...\Roaming\lib\types\tuiDisplayPrefs.js'`, so this live arm could not run
  // there at all. Each candidate is VALIDATED by the host files it must carry.
  /** Every candidate root, in probe order: the symlink target first, then the upward walk. */
  const candidates: string[] = []
  try {
    /** The launcher's real path, or an empty string when this platform cannot resolve one. */
    const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
    if (real !== "") candidates.push(dirname(dirname(real)))
  } catch {
    // No `readlink` here: the upward walk below is the remaining resolution.
  }
  /** The directory this walk is at, moved one level up per iteration. */
  let dir = dirname(launcher)
  for (let level = 0; level < 8; level += 1) {
    candidates.push(join(dir, "node_modules", "@deepseek-harness-tui", "dsh-tui"))
    /** The parent directory; equal to `dir` at the filesystem root, which ends the walk. */
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const candidate of candidates) if (existsSync(join(candidate, "lib", "types", "tuiDisplayPrefs.js"))) return candidate
  throw new Error(`dsh-tui launcher ${launcher}: no installed host package found (tried ${candidates.join(", ")})`)
}

describe("T1 · the stale-default predicate, as a pure decision", () => {
  test("the known stale default is exactly the 0.13.0 list, normalized", () => {
    expect(KNOWN_STALE_PANEL_DEFAULTS).toEqual(["todo,jobs,agents"])
  })

  test("a known stale residue DIFFERING from the host's default is the migration's trigger", () => {
    expect(stalePanelDefaultResidue(STALE_PIN, HOST_DEFAULT)).toBe(STALE_PIN)
  })

  test("the SAME list as the host's current default is NOT a trigger — a 0.13.0 host is unchanged", () => {
    // The clause the whole rule turns on: on the host whose own default IS the stale entry there is
    // nothing missing to restore, so the predicate is false and the merge is byte-identical to before.
    expect(stalePanelDefaultResidue(STALE_PIN, STALE_PIN)).toBe("")
  })

  test("an unreadable or empty host default leaves the migration INERT, never a wildcard", () => {
    expect(stalePanelDefaultResidue(STALE_PIN, undefined)).toBe("")
    expect(stalePanelDefaultResidue(STALE_PIN, "")).toBe("")
  })

  test("only a KNOWN stale list triggers: a custom list and an empty residue never do", () => {
    expect(stalePanelDefaultResidue("todo,workspace", HOST_DEFAULT)).toBe("")
    expect(stalePanelDefaultResidue("", HOST_DEFAULT)).toBe("")
    expect(stalePanelDefaultResidue(`${STALE_PIN},someone:else`, HOST_DEFAULT)).toBe("")
  })
})

describe("T1 · the merge: the migration target is the host's default ∪ our ids", () => {
  test("the stale pin migrates, in the host's order, with our ids appended in registration order", () => {
    /** The merge of the reported defect: a profile pinning the 0.13.0 list, with our ids registered. */
    const merge = mergePanelEnableIds(STALE_PIN, OURS, [], HOST_DEFAULT)
    expect(merge.staleDefault).toBe(STALE_PIN)
    expect(merge.csv).toBe(MIGRATED)
  })

  test("the pin WITH our ids already in it migrates to the same target, not to a doubled list", () => {
    /** The shape the host's own registration append leaves on a stale profile. */
    const merge = mergePanelEnableIds(`${STALE_PIN},act1:team`, OURS, [], HOST_DEFAULT)
    expect(merge.staleDefault).toBe(STALE_PIN)
    expect(merge.csv).toBe(MIGRATED)
  })

  test("a provably-dead id of ours is part of the residue removal and does not block the migration", () => {
    // `act7:team` is ours by PROVENANCE (it is in the record's history), so it is not part of the user's
    // own list: the residue is still exactly the stale pin, and the dead token is not carried over.
    /** The merge of a stale pin left behind by an earlier boot. */
    const merge = mergePanelEnableIds(`${STALE_PIN},act7:team`, OURS, ["act7:team"], HOST_DEFAULT)
    expect(merge.staleDefault).toBe(STALE_PIN)
    expect(merge.csv).toBe(MIGRATED)
  })

  test("a custom list keeps its exact order and contents, and only ever gains our ids", () => {
    /** The merge of the contract's own example custom list, ours absent. */
    const merge = mergePanelEnableIds("todo,workspace", OURS, [], HOST_DEFAULT)
    expect(merge.staleDefault).toBe("")
    expect(merge.csv).toBe("todo,workspace,act1:team,act1:workmate")
  })

  test("a custom list that already names us is never migrated, and its order is untouched", () => {
    /** The merge of a deliberate two-panel selection. */
    const merge = mergePanelEnableIds("todo,workspace,act1:team", OURS, [], HOST_DEFAULT)
    expect(merge.staleDefault).toBe("")
    // `kept` IS the user's list, which is what the keeper's stand-down writes (a prune-only write, or
    // nothing at all): no token of theirs moves and none of ours is appended on this path.
    expect(merge.kept.join(",")).toBe("todo,workspace,act1:team")
    expect(merge.present).toEqual(["act1:team"])
  })

  test("an UNREADABLE host default writes the old target — `kept ∪ added`, exactly as before", () => {
    /** The merge with no host default at all, which is the degrade the keeper logs once. */
    const merge = mergePanelEnableIds(STALE_PIN, OURS, [], undefined)
    expect(merge.staleDefault).toBe("")
    expect(merge.csv).toBe(`${STALE_PIN},act1:team,act1:workmate`)
  })

  test("with NOTHING registered the migration does not open a write path of its own", () => {
    // The keeper arms on its first registration, so this state is unreachable in a boot — and pinning it
    // keeps an accidental arm from rewriting a user's list with no ids of ours to carry.
    /** The merge of a stale pin with no registration at all. */
    const merge = mergePanelEnableIds(STALE_PIN, [], [], HOST_DEFAULT)
    expect(merge.staleDefault).toBe("")
    expect(merge.csv).toBe(STALE_PIN)
  })
})

describe("T1 · the host's default is READ from the host module, never hardcoded", () => {
  test("a staged host's own DEFAULT_SIDE_PANEL_IDS comes back normalized, in the host's order", async () => {
    // A host whose default is NOT the machine's: a hardcoded copy of the 0.14.0 list would answer the
    // wrong string here, which is the whole point of reading the export live.
    /** The staged host, carrying a default no constant in this bundle names. */
    const staged = stagePrefsHost(`${STORE_MEMBERS}export const DEFAULT_SIDE_PANEL_IDS = 'Alpha, beta ,alpha,gamma'\n`)
    try {
      /** The probe's answer for that install. */
      const probe = await probeHostPrefs([staged.root])
      expect(probe.prefs).toBeDefined()
      expect(probe.defaultIds).toBe("alpha,beta,gamma")
    } finally {
      rmSync(staged.parent, { recursive: true, force: true })
    }
  })

  test("a host that exports no default still BINDS the store, with the migration field ABSENT", async () => {
    /** The staged host, whose prefs module carries the store members and no default. */
    const staged = stagePrefsHost(STORE_MEMBERS)
    try {
      /** The probe's answer for that install. */
      const probe = await probeHostPrefs([staged.root])
      // The store is still the contact — this host simply has no default to read — and the absent field
      // is what makes the keeper's migration inert rather than guessed.
      expect(probe.prefs).toBeDefined()
      expect(probe.defaultIds).toBeUndefined()
    } finally {
      rmSync(staged.parent, { recursive: true, force: true })
    }
  })

  test("a non-string, or empty, default export is unreadable rather than a wildcard", async () => {
    for (const body of ["export const DEFAULT_SIDE_PANEL_IDS = ['todo','jobs']\n", "export const DEFAULT_SIDE_PANEL_IDS = ''\n"]) {
      /** The staged host for this spelling. */
      const staged = stagePrefsHost(`${STORE_MEMBERS}${body}`)
      try {
        /** The probe's answer for that install. */
        const probe = await probeHostPrefs([staged.root])
        expect(probe.defaultIds).toBeUndefined()
      } finally {
        rmSync(staged.parent, { recursive: true, force: true })
      }
    }
  })

  test("against the INSTALLED host: the migration target is the host's own default, in its own order", async () => {
    // THE A1/A4 ACCEPTANCE, READ OFF THE REAL HOST rather than off a literal in this file: the probe's
    // default IS the export of the installed module, and the migrated CSV is that list in the host's own
    // order with our ids appended — which is the axis the sidebar's tab order follows.
    /** The installed host's root. */
    const host = installedHostRoot()
    /** The host's own display-prefs module, loaded by the same absolute-file-URL route the probe uses. */
    const prefs = await import(pathToFileURL(join(host, HOST_PREFS_MODULE)).href) as { DEFAULT_SIDE_PANEL_IDS?: unknown; normalizeSidePanelPanels?: (value: unknown) => string }
    expect(typeof prefs.DEFAULT_SIDE_PANEL_IDS).toBe("string")
    /** The host's own default list, through the host's OWN normalizer. */
    const live = String(prefs.normalizeSidePanelPanels?.(prefs.DEFAULT_SIDE_PANEL_IDS))
    expect(live.length).toBeGreaterThan(0)
    /** The contact's answer for that install. */
    const probe = await probeHostPrefs([host])
    expect(probe.defaultIds).toBe(live)
    // The migrated list is the host's default VERBATIM, then our ids in registration order.
    /** The merge of the stale pin against the live host default. */
    const merge = mergePanelEnableIds(STALE_PIN, OURS, [], probe.defaultIds)
    expect(merge.staleDefault).toBe(STALE_PIN)
    expect(merge.csv).toBe(`${live},${OURS.join(",")}`)
    // …and that target is genuinely LONGER than the stale pin: the builtins really do come back.
    expect(merge.csv.split(",").length).toBe(live.split(",").length + OURS.length)
  })
})

describe("T1 · the keeper migrates the stale pin on BOTH repair paths", () => {
  test("the LADDER path migrates the pin, then repairs the mirror's rewrite, then stands down", async () => {
    /** The store, seeded with the profile's stale pin and NO feed (the ladder's degradation case). */
    const fake = fakeStore(STALE_PIN)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, told the host default by its own probe answer. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // A1/T1: the write is the host's default ∪ ours, in that order — the axis the tab order follows.
    expect(fake.csv()).toBe(MIGRATED)
    expect(fake.applied).toEqual([MIGRATED])
    expect(keeper.outcome().detail).toContain(`migrated the stale default ${STALE_PIN}`)
    // The host's configuration mirror rewrites the CSV from the user layer, exactly as measured.
    fake.hostApply(STALE_PIN)
    await clock.runNext()
    expect(fake.csv()).toBe(MIGRATED)
    expect(fake.applied).toEqual([MIGRATED, STALE_PIN, MIGRATED])
    // The migrated list is the ordinary "host default ∪ ours" state, so the next read stands down.
    await clock.runNext()
    expect(fake.applied.length).toBe(3)
    expect(keeper.outcome().detail).toContain("standing down")
  })

  test("the FEED path migrates at arm time and again when the mirror rewrites the stale pin", async () => {
    /** The store, seeded with the stale pin and carrying the host's own change feed. */
    const fake = fakeStore(STALE_PIN, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, reading the store's own members through the fake's live getters. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // THE ARM-TIME READ IS THE FEED'S, and it migrates: the host's own registration append plus a stale
    // profile layer is a residue nobody chose, so it is repaired rather than watched.
    expect(fake.listeners()).toBe(1)
    expect(fake.csv()).toBe(MIGRATED)
    expect(fake.applied).toEqual([MIGRATED])
    // …and the keeper is STILL ALIVE for the mirror's later rewrite, which is the F5 repair.
    fake.hostApply(STALE_PIN)
    expect(fake.csv()).toBe(MIGRATED)
    expect(fake.applied).toEqual([MIGRATED, STALE_PIN, MIGRATED])
    expect(keeper.outcome().reasserted).toBe(2)
    // A list that names us with a CUSTOM residue is a position, so the keeper stands down for good…
    fake.hostApply("todo,workspace,act1:team")
    expect(fake.applied.length).toBe(4)
    expect(fake.listeners()).toBe(0)
    expect(keeper.outcome().detail).toContain("standing down")
    // …and a retired keeper no longer answers the mirror at all: the stale pin stays where it was put.
    fake.hostApply(STALE_PIN)
    expect(fake.csv()).toBe(STALE_PIN)
    expect(fake.applied.length).toBe(5)
  })

  test("a DELIBERATE custom list is never rewritten, on the ladder or through the feed", async () => {
    /** The store, seeded with the contract's own example custom list. */
    const fake = fakeStore("todo,workspace")
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    await clock.runNext()
    // The ordinary repair: our id is appended after the user's list, whose order is untouched.
    expect(fake.csv()).toBe("todo,workspace,act1:team")
    // The next read names us, and its residue is NOT a known stale default — so the keeper stands down.
    await clock.runNext()
    expect(fake.applied.length).toBe(1)
    expect(keeper.outcome().detail).toContain("standing down")
  })

  test("the CURRENT default ∪ ours stands down untouched, and is not migrated", async () => {
    /** The store, seeded with the state the panelled script's own apply leaves. */
    const fake = fakeStore(MIGRATED)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    expect(fake.applied).toEqual([])
    expect(fake.csv()).toBe(MIGRATED)
    expect(keeper.outcome().reasserted).toBe(0)
    expect(keeper.outcome().detail).toContain("standing down")
  })

  test("an UNREADABLE host default degrades INERT: one log line, and the old merge on the wire", async () => {
    /** The store, seeded with the stale pin — which NOW stays a stale pin. */
    const fake = fakeStore(STALE_PIN)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer carries NO host default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    await clock.runNext()
    // INERT: the target is `kept ∪ added`, exactly as before this rule existed.
    expect(fake.csv()).toBe(`${STALE_PIN},act1:team`)
    expect(keeper.outcome().detail).not.toContain("migrated")
    // …and the degrade is SAID, ONCE, on the keeper's own sink (never a terminal).
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain("DEFAULT_SIDE_PANEL_IDS")
    await clock.runNext()
    await clock.runNext()
    expect(logged.length).toBe(1)
  })

  test("a 0.13.0 host — whose own default IS the pin — keeps the pre-migration behaviour", async () => {
    /** The store, seeded with the pin. */
    const fake = fakeStore(STALE_PIN)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose host default EQUALS the list on the wire. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: STALE_PIN }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    await clock.runNext()
    expect(fake.csv()).toBe(`${STALE_PIN},act1:team`)
    expect(keeper.outcome().detail).toContain("re-asserted act1:team")
  })
})

describe("C2 · the keeper stands down on a self-healing host (>= 0.15.0)", () => {
  test("the version predicate: 0.15.0 and later self-heal; older, empty and unparseable versions do not", () => {
    expect(hostSelfHealsPanelCsv(PANEL_CSV_SELF_HEAL_SINCE)).toBe(true)
    expect(hostSelfHealsPanelCsv("0.15.1")).toBe(true)
    expect(hostSelfHealsPanelCsv("0.16.0")).toBe(true)
    expect(hostSelfHealsPanelCsv("1.0.0")).toBe(true)
    // DEGRADE-SAFE: everything the gate cannot read as at-least-0.15.0 keeps the legacy keeper.
    expect(hostSelfHealsPanelCsv("0.14.0")).toBe(false)
    expect(hostSelfHealsPanelCsv("0.13.0")).toBe(false)
    expect(hostSelfHealsPanelCsv("0.14.0-rc.1")).toBe(false)
    expect(hostSelfHealsPanelCsv("")).toBe(false)
    expect(hostSelfHealsPanelCsv("not-a-version")).toBe(false)
  })

  test("(a) on a 0.15.0 host the keeper writes NOTHING: a mirror rewrite is not repaired, and the belt observes it once", async () => {
    // THE 0.14 DEFECT'S TRIGGER, replayed on a self-healing host: the configuration mirror rewrites
    // the CSV to a list that names none of ours. The 0.14 keeper repaired that; the C2 keeper must
    // not even try — the host's own union is the writer now, and this arm asserts OUR side of that
    // hand-off: zero writes, ever.
    /** The store with the feed exposed, as every 0.14.0+ build does. */
    const fake = fakeStore(HOST_DEFAULT, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer names a self-healing host. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0" }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // STOOD DOWN on the FIRST tick: no write happened, the state is confirmed, the detail names the reason.
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().reasserted).toBe(0)
    expect(keeper.outcome().state).toBe("confirmed")
    expect(keeper.outcome().detail).toContain("self-heals")
    // THE MIRROR REWRITE: the host writes a builtins-only list and the keeper DOES NOT REPAIR IT —
    // the applied log carries the host's write and nothing else.
    fake.hostApply("todo,jobs,agents")
    expect(fake.applied).toEqual(["todo,jobs,agents"])
    expect(keeper.outcome().reasserted).toBe(0)
    // THE BELT: one stand-down line and one observe-only line; the belt STAYS SUBSCRIBED (S1: it
    // re-checks every event for a re-presented stale default) but never writes here — this probe
    // carries NO readable default, so the re-check is inert and a second host apply says nothing more.
    expect(logged.some((line) => line.includes("standing down on host 0.15.0"))).toBe(true)
    expect(logged.filter((line) => line.includes("observe-only")).length).toBe(1)
    expect(logged.some((line) => line.includes("NONE of our ids"))).toBe(true)
    expect(fake.listeners()).toBe(1)
    fake.hostApply("todo,jobs")
    expect(logged.filter((line) => line.includes("observe-only")).length).toBe(1)
    // NO LATER LADDER TICK WRITES EITHER — the stand-down cancelled the ladder.
    await clock.runNext()
    await clock.runNext()
    expect(fake.applied).toEqual(["todo,jobs,agents", "todo,jobs"])
  })

  test("(a) an explicit /settings removal of BOTH panels STAYS removed on a 0.15.0 host — the belt reports the union keeping them, then silence", async () => {
    // THE R1 RESIDUAL THE RE-SPEC EXISTS FOR: the host records a `/settings` removal session-wide, and
    // a keeper that still "repaired" the list would re-add panels the user explicitly turned off. The
    // realistic sequence: the registration append put our ids in, then the user removes both.
    /** The store with the feed exposed. */
    const fake = fakeStore(HOST_DEFAULT, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer names a self-healing host. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0" }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // THE HOST'S OWN REGISTRATION APPEND (the union's doing, not ours): the belt sees our ids carried.
    fake.hostApply(`${HOST_DEFAULT},${OURS.join(",")}`)
    expect(logged.filter((line) => line.includes("observe-only")).length).toBe(1)
    expect(logged.some((line) => line.includes("still carries every id of ours"))).toBe(true)
    expect(fake.applied).toEqual([`${HOST_DEFAULT},${OURS.join(",")}`])
    // THE USER REMOVES BOTH via `/settings`: the list drops every id of ours and the keeper NEVER
    // writes them back — not on the removal itself, and not on any later tick.
    fake.hostApply(HOST_DEFAULT)
    await clock.runNext()
    await clock.runNext()
    await clock.runNext()
    expect(fake.applied).toEqual([`${HOST_DEFAULT},${OURS.join(",")}`, HOST_DEFAULT])
    expect(fake.csv()).toBe(HOST_DEFAULT)
    expect(keeper.outcome().reasserted).toBe(0)
    expect(logged.filter((line) => line.includes("observe-only")).length).toBe(1)
  })

  test("(b) a 0.14.0 host keeps the legacy keeper byte-for-byte: the mirror rewrite IS repaired, version explicit", async () => {
    /** The store with the feed exposed, seeded with the current default. */
    const fake = fakeStore(HOST_DEFAULT, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer names a legacy host. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.14.0" }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    await clock.runNext()
    // FIRST TICK: the feed hands over, the list names none of ours, and the keeper RE-ASSERTS — the
    // exact 0.14 behaviour, now guarded by an explicit version.
    expect(fake.applied).toEqual([`${HOST_DEFAULT},act1:team`])
    expect(keeper.outcome().reasserted).toBe(1)
    // THE MIRROR REWRITE: the host drops our id and the keeper REPAIRS it through the feed — the
    // 0.14 repair this clause preserves on exactly these hosts.
    fake.hostApply("todo,jobs,agents")
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    expect(fake.applied).toEqual([`${HOST_DEFAULT},act1:team`, "todo,jobs,agents", "todo,jobs,agents,act1:team"])
    expect(keeper.outcome().reasserted).toBe(2)
  })

  test("(b) an ABSENT version — the pre-C2 probe shape — keeps the legacy keeper: no gate fires", async () => {
    // DEGRADE-SAFE, pinned: every probe answer that carries no version (the shape all 22 arms above
    // were written against) takes the legacy path, so the gate can never stand a keeper down on a
    // host it failed to read.
    /** The store, seeded with the stale pin so the migration is the observable. */
    const fake = fakeStore(STALE_PIN)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer carries NO version at all. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    await clock.runNext()
    // The FULL legacy machinery runs — the stale-default migration included, which is the strongest
    // "byte-preserved" witness available on one tick: the pin migrated to the host default ∪ ours.
    expect(fake.csv()).toBe(`${HOST_DEFAULT},act1:team`)
    expect(keeper.outcome().detail).toContain("migrated the stale default")
  })
})

// S1 of `fix/sidebar-015-keeper-migration` (2026-10-16): the stale-default migration RE-ARMS on a
// self-healing host. The C2 stand-down had swallowed it — the gate returned from the tick before
// `decide`, the only caller of the merge, so on a `>= 0.15.0` host a 0.13.0-era user pin was healed by
// no one (the host's own union heals only REGISTERED PLUGIN ids). The keeper now evaluates the SAME T1
// predicate before standing down, and the observe-only belt re-evaluates it on every feed event. Every
// arm below drives the mounted row's own surface (`createPanelEnableKeeper`), with the probe answer a
// 0.15.0 host really gives: `hostVersion` "0.15.0" plus the live `defaultIds`.
describe("S1 · the stale-default migration re-arms on a self-healing host", () => {
  test("(a) a stale pin on 0.15.0: the LADDER tick migrates it to the host default ∪ ours, then stands down", async () => {
    /** The store with the feed exposed (every 0.15.0 build has one), seeded with the reported pin. */
    const fake = fakeStore(STALE_PIN, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe answer names a self-healing host AND its live default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // A1: the ONE write a self-healing host still gets — the host's default ∪ ours, in that order.
    expect(fake.applied).toEqual([MIGRATED])
    expect(fake.csv()).toBe(MIGRATED)
    expect(keeper.outcome().reasserted).toBe(1)
    expect(keeper.outcome().state).toBe("confirmed")
    expect(keeper.outcome().detail).toContain("self-heals")
    expect(logged.some((line) => line.includes(`migrated the stale default ${STALE_PIN}`))).toBe(true)
    expect(logged.some((line) => line.includes("standing down on host 0.15.0"))).toBe(true)
    // The stand-down owns the ONE listener (the belt, not the repair feed) and cancelled the ladder,
    // so no later tick can write anything.
    expect(fake.listeners()).toBe(1)
    await clock.runNext()
    expect(fake.applied.length).toBe(1)
  })

  test("(b) a MID-SESSION feed event re-applying the stale pin: the belt re-migrates it", async () => {
    /** The store with the feed exposed, seeded with the reported pin. */
    const fake = fakeStore(STALE_PIN, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    expect(fake.applied).toEqual([MIGRATED])
    // The host's one-time import hop / config mirror re-presents the stale pin MID-SESSION (the
    // measured 0.15.0 defect): the stood-down belt re-evaluates the predicate and re-migrates.
    fake.hostApply(STALE_PIN)
    expect(fake.applied).toEqual([MIGRATED, STALE_PIN, MIGRATED])
    expect(fake.csv()).toBe(MIGRATED)
    expect(keeper.outcome().reasserted).toBe(2)
    expect(logged.some((line) => line.includes("stale-default belt"))).toBe(true)
  })

  test("(c) the CURRENT default ∪ ours: NO write on the tick or any belt event (C2 preserved)", async () => {
    /** The store with the feed exposed, seeded with the state a repaired layer carries. */
    const fake = fakeStore(MIGRATED, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // The residue IS the host's own default, so the predicate is false: the keeper stands down with
    // zero writes — the C2 clause, unchanged by the re-arm.
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().reasserted).toBe(0)
    expect(logged.some((line) => line.includes("migrated"))).toBe(false)
    // A `/settings` removal of BOTH panels is a NON-STALE event: observed once, never repaired.
    fake.hostApply(HOST_DEFAULT)
    expect(fake.applied).toEqual([HOST_DEFAULT])
    expect(fake.csv()).toBe(HOST_DEFAULT)
    expect(keeper.outcome().reasserted).toBe(0)
    expect(logged.filter((line) => line.includes("observe-only")).length).toBe(1)
  })

  test("(d) a DELIBERATE custom list: NO write ever, on the tick or the belt", async () => {
    /** The store with the feed exposed, seeded with the contract's own example custom list. */
    const fake = fakeStore("todo,workspace", true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // A custom residue is a position, not a default: the keeper never even migrates it.
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().reasserted).toBe(0)
    // The host's own union appends ours; the residue stays the custom list — never a migration.
    fake.hostApply("todo,workspace,act1:team,act1:workmate")
    fake.hostApply("todo,workspace")
    expect(keeper.outcome().reasserted).toBe(0)
    expect(logged.some((line) => line.includes("migrated"))).toBe(false)
  })

  test("(e) an UNREADABLE host default: inert, exactly ONE degrade line, and no write", async () => {
    /** The store with the feed exposed, seeded with the stale pin — which stays a stale pin. */
    const fake = fakeStore(STALE_PIN, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose probe names a self-healing host with NO readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0" }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // Without a target there is no migration: the keeper stands down having written nothing.
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().reasserted).toBe(0)
    /** How many degrade lines the keeper said — the contract's "at most the ONE" bound. */
    const degrades = (): number => logged.filter((line) => line.includes("DEFAULT_SIDE_PANEL_IDS")).length
    expect(degrades()).toBe(1)
    // The belt re-check is equally inert, and never repeats the degrade line on later events.
    fake.hostApply(STALE_PIN)
    fake.hostApply("todo,jobs")
    expect(degrades()).toBe(1)
    expect(keeper.outcome().reasserted).toBe(0)
  })

  test("(f) a stale pin with NOTHING registered: the migration stays gated on registration", async () => {
    /** The store with the feed exposed, seeded with the stale pin. */
    const fake = fakeStore(STALE_PIN, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    // NO registration: the ladder arms on the first `observe` only, so no tick ever runs — an empty
    // registration set can never open a write path of its own.
    expect(clock.delays).toEqual([])
    await clock.runNext()
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().reasserted).toBe(0)
    // The pure guard this rests on, restated for this host shape: with `ours` empty the merge answers
    // no stale default, so even a driven tick would have written nothing.
    expect(mergePanelEnableIds(STALE_PIN, [], [], HOST_DEFAULT).staleDefault).toBe("")
  })

  test("(g) idempotence: after the belt's re-migration the next event writes NOTHING", async () => {
    /** The store with the feed exposed, seeded with the reported pin. */
    const fake = fakeStore(STALE_PIN, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    fake.hostApply(STALE_PIN)
    expect(keeper.outcome().reasserted).toBe(2)
    // THE NEXT EVENT (the host applying its own plain default — e.g. our ids removed): the residue IS
    // the host default, so the predicate is false and the belt only observes. No loop, no re-add.
    fake.hostApply(HOST_DEFAULT)
    expect(fake.applied).toEqual([MIGRATED, STALE_PIN, MIGRATED, HOST_DEFAULT])
    expect(fake.csv()).toBe(HOST_DEFAULT)
    expect(keeper.outcome().reasserted).toBe(2)
  })
})

// R2 of `fix/sidebar-015-keeper-migration` (CodeRabbit PR #44): the wave's OWN new code — the
// self-healer migration path — made three promises the arms below pin: its errors are CONTAINED as
// recorded refusals (never unhandled rejections), a `stop()` that races a pending probe retires the
// keeper for good (no migration, no belt, no late write), and a host that drops the migration write
// settles REFUSED (never a `confirmed` hiding the stale list that remains).
describe("R2 · the self-healer migration is contained, disposal-safe and honest", () => {
  test("(R2.1) a store whose apply throws settles a recorded refusal — zero unhandled rejections", async () => {
    /** Every unhandled rejection observed during the arm; the contract is that it stays EMPTY. */
    const unhandled: unknown[] = []
    /** The collector, attached for the arm's duration only and detached in the finally below. */
    const collect = (reason: unknown): void => { unhandled.push(reason) }
    process.on("unhandledRejection", collect)
    try {
      /** The store whose apply throws — the exact host defect the finding names. */
      const store: TuiHostPrefsLike = {
        getSidePanelPanels: (): unknown => STALE_PIN,
        applySidePanelPanels: (): unknown => { throw new Error("the staged host refused the apply") },
      }
      /** The controllable clock. */
      const clock = fakeClock()
      /** The keeper under test, on a self-healing host whose store refuses every write. */
      const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
      keeper.observe("act1:team")
      await clock.runNext()
      // The throw from inside the migration decision path is a RECORDED refusal, never a rejection of
      // the promise `.then` returned (the rejection handler covers `loadPrefs` only).
      expect(keeper.outcome().state).toBe("refused")
      expect(keeper.outcome().detail).toContain("the migration decision path threw")
      expect(keeper.outcome().detail).toContain("the staged host refused the apply")
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", collect)
    }
  })

  test("(R2.2) a loadPrefs() resolving AFTER stop() neither migrates nor installs the belt", async () => {
    /** The store with the feed exposed, seeded with the stale pin a late probe would have migrated. */
    const fake = fakeStore(STALE_PIN, true)
    /** Resolves the pending probe; the arm owns the timing so `stop()` lands while it is in flight. */
    let resolveProbe: (probe: { prefs: TuiHostPrefsLike; hostVersion: string; defaultIds: string }) => void = (): void => {}
    /** The pending-probe loader, unresolved until the arm releases it. */
    const loadPrefs = (): Promise<{ prefs: TuiHostPrefsLike; hostVersion: string; defaultIds: string }> =>
      new Promise((resolve): void => { resolveProbe = resolve })
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, whose first tick is parked inside the unresolved probe. */
    const keeper = createPanelEnableKeeper({ loadPrefs, schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    await clock.runNext()
    // DISPOSAL WHILE PENDING: the scope went away before the probe answered.
    keeper.stop()
    resolveProbe({ prefs: fake.store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT })
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    // No migration of the retired activation's ids, no belt subscription left attached, no settle.
    expect(fake.applied).toEqual([])
    expect(fake.listeners()).toBe(0)
    expect(keeper.outcome().state).toBe("requested")
  })

  test("(R2.2) a belt the host never gave an unsubscribe for stays silent after stop()", async () => {
    /** The CSV the store holds. */
    let csv = STALE_PIN
    /** Every apply attempted through the store, the host's rewrites included. */
    const applied: string[] = []
    /** The listeners the store keeps forever — a host whose subscribe returns NO unsubscribe. */
    const listeners = new Set<() => void>()
    /** The store modelling that host: `stop()` cannot detach the belt, only the latch can silence it. */
    const store: TuiHostPrefsLike = {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => {
        applied.push(String(value))
        if (value === csv) return csv
        csv = String(value)
        for (const listener of [...listeners]) listener()
        return csv
      },
      subscribeSidePanelPanels: (listener: () => void): unknown => {
        listeners.add(listener)
        return undefined
      },
    }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host with a readable default. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // The tick migrated the pin and installed the belt — the subscription `stop()` cannot release.
    expect(applied).toEqual([MIGRATED])
    expect(csv).toBe(MIGRATED)
    expect(listeners.size).toBe(1)
    keeper.stop()
    // THE HOST RE-PRESENTS THE STALE PIN after disposal: the belt is still attached and MUST NOT
    // write the retired activation's ids back.
    applied.push(STALE_PIN)
    csv = STALE_PIN
    for (const listener of [...listeners]) listener()
    expect(applied).toEqual([MIGRATED, STALE_PIN])
    expect(csv).toBe(STALE_PIN)
    expect(keeper.outcome().reasserted).toBe(1)
  })

  test("(R2.3) a host that drops the migration write settles REFUSED, never confirmed", async () => {
    /** The CSV the store holds — the stale pin, no matter what is applied. */
    let csv = STALE_PIN
    /** Every apply attempted through the store. */
    const applied: string[] = []
    /** The belt listeners, so the arm can drive the per-event re-check. */
    const listeners = new Set<() => void>()
    /** The store that DROPS the write: the apply is recorded and acknowledged, the pin remains. */
    const store: TuiHostPrefsLike = {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => {
        applied.push(String(value))
        return csv
      },
      subscribeSidePanelPanels: (listener: () => void): unknown => {
        listeners.add(listener)
        return (): void => { listeners.delete(listener) }
      },
    }
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, on a self-healing host that will not retain the migration CSV. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store, hostVersion: "0.15.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // The write was ATTEMPTED and dropped, so the stand-down must carry the refusal into its settle:
    // before R2.3 this same run settled `confirmed` while the stale list remained on the host.
    expect(applied).toEqual([MIGRATED])
    expect(csv).toBe(STALE_PIN)
    expect(keeper.outcome().state).toBe("refused")
    expect(keeper.outcome().detail).toContain("standing down")
    expect(keeper.outcome().detail).toContain("the stale-default migration write was refused")
    // The belt is still installed — its per-event re-check is the retry path for exactly this refusal.
    expect(listeners.size).toBe(1)
    for (const listener of [...listeners]) listener()
    expect(applied).toEqual([MIGRATED, MIGRATED])
    expect(keeper.outcome().state).toBe("refused")
    expect(logged.some((line) => line.includes("the re-migration write was refused"))).toBe(true)
  })
})

// G1 of the STATELESS-DEPLOYMENT wave (2026-10-20): on a host that OWNS the enable list the adapter is
// READ-ONLY. 0.16.1's `TuiPanelRuntime.register()` enables a panel on registration, `dispose()` removes
// it, and both the boot and the settings apply union every registered id back — so every write this
// keeper could still make is a second writer racing the host's own merge, and the recurring
// "our bundle rewrote the sidebar enable list" incident class the older repair paths belong to.
//
// THE ARMS BELOW PIN THE WHOLE CLAIM: no write (not even the stale-default migration), no belt and no
// feed on >= 0.16.1, while the 0.15.0 host keeps the S1 migration byte for byte (the arms above).
describe("G1 · the adapter is READ-ONLY on a host that owns the enable list (>= 0.16.1)", () => {
  test("the ownership predicate starts at 0.16.1, and unreadable versions stay out of it", () => {
    expect(hostOwnsPanelCsv("0.16.1")).toBe(true)
    expect(hostOwnsPanelCsv("0.16.1-rc.2")).toBe(true)
    expect(hostOwnsPanelCsv("0.17.0")).toBe(true)
    expect(hostOwnsPanelCsv("1.0.0")).toBe(true)
    // THE BOUNDARY IS EXACT: a self-healing host BELOW the ownership gate keeps the S1 migration.
    expect(hostOwnsPanelCsv("0.16.0")).toBe(false)
    expect(hostOwnsPanelCsv("0.15.9")).toBe(false)
    // DEGRADE-SAFE: everything the gate cannot read keeps the older, pinned behaviour.
    expect(hostOwnsPanelCsv("")).toBe(false)
    expect(hostOwnsPanelCsv("next")).toBe(false)
    // The shared comparison the two gates are built on.
    expect(hostVersionAtLeast("0.16.1", "0.16.1")).toBe(true)
    expect(hostVersionAtLeast("0.16.0", "0.16.1")).toBe(false)
    expect(hostVersionAtLeast("garbage", "0.16.1")).toBe(false)
  })

  test("(a) 0.16.1 with a STALE PIN: the keeper writes NOTHING — no migration, no belt, no feed", async () => {
    /** The host store, with a feed exposed (0.16.1 has one) so a belt WOULD be observable. */
    const fake = fakeStore(STALE_PIN, true)
    /** Every line the keeper logged. */
    const logged: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test on the owning host. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.16.1", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [], log: (line: string): void => { logged.push(line) } })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    clock.runNext()
    // WAIT FOR THE PROMISE CHAIN the keeper's tick runs on.
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    // THE WHOLE CLAIM: not one apply reached the host, and the stale list is exactly as it was.
    expect(fake.applied).toEqual([])
    expect(fake.csv()).toBe(STALE_PIN)
    // NO BELT: the store's feed was never subscribed (a belt here would only re-migrate).
    expect(fake.listeners()).toBe(0)
    // The outcome and the ONE line both SAY read-only, so a support run reads the reason.
    expect(keeper.outcome().state).toBe("confirmed")
    expect(keeper.outcome().detail).toContain("read-only")
    expect(keeper.outcome().detail).toContain("writes nothing")
    expect(logged.some((line) => line.includes("standing down READ-ONLY on host 0.16.1"))).toBe(true)
    // The discovered ids still reach the diagnostic consumer — the half that is not a write.
    expect(keeper.outcome().ids).toEqual(["act1:team", "act1:workmate"])
  })

  test("(b) 0.16.1 with a CURRENT list: still nothing written, and no tick is left armed", async () => {
    /** A store whose list already names us, the ordinary post-registration shape on an owning host. */
    const fake = fakeStore(`${HOST_DEFAULT},${OURS.join(",")}`, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.16.1", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    clock.runNext()
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    expect(fake.applied).toEqual([])
    expect(fake.listeners()).toBe(0)
    // THE LADDER IS CANCELLED: the remaining armed ticks were released, so nothing can write later.
    expect(clock.delays.length).toBe(PANEL_KEEPER_LADDER_MS.length)
    await clock.runNext()
    expect(fake.applied).toEqual([])
    expect(keeper.outcome().ticks).toBe(1)
  })

  test("(c) 0.16.0 is BELOW the gate: the S1 migration still runs exactly once", async () => {
    /** The same stale pin on the last self-healing-but-not-owning host. */
    const fake = fakeStore(STALE_PIN, true)
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.16.0", defaultIds: HOST_DEFAULT }), schedule: clock.schedule, pastIds: () => [] })
    keeper.observe("act1:team")
    keeper.observe("act1:workmate")
    clock.runNext()
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    expect(fake.applied).toEqual([MIGRATED])
    expect(keeper.outcome().detail).toContain("self-heals")
  })
})
