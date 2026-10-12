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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  HOST_PREFS_MODULE,
  KNOWN_STALE_PANEL_DEFAULTS,
  createPanelEnableKeeper,
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
  /** The launcher's real path, with the symlink the package manager installs behind it resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  // `<root>/bin/dsh-tui.js` -> `<root>`: two directories up, the same shape every lane resolves.
  return dirname(dirname(real))
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
