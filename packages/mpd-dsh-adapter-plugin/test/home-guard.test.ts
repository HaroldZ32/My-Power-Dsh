// THE SHARED HOME-SCOPED MUTATION GUARD (T-43) — moved into the adapter by wave W0.
//
// WHY THIS FILE EXISTS: the guard used to be PRIVATE to the workmate row, and the global-memory row
// (decision D6) must guard `~/.mpd/memory` the same way. The predicate now lives in ONE place, so the
// pin lives with it: an isolated boot (`DSH_HOME` set) may mutate a SANDBOXED home and must REFUSE a
// mutation aimed at the real one, with the row's refusal text unchanged.
//
// SAFETY: every arm passes the root EXPLICITLY and the guard only COMPARES paths — it never creates,
// reads or writes anything under a home — so the real `~/.mpd` cannot be touched from here. The
// sandboxes this file does create are mkdtemp trees outside the workspace, removed at the end.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HomeGuardRefusal, assertHomeMutationSandboxed, realUserHome } from "../src/index.ts"
import { assertMutationSandboxed as workmateGuard } from "../../mpd-workmate-plugin/src/index.ts"

/** The environment keys every arm re-points, restored after each case so no arm leaks into the suite. */
const ENV_KEYS = ["HOME", "DSH_HOME", "MPD_DSH_WORKMATE_ALLOW_REAL_HOME"] as const

/** The values those keys held before this file touched them. */
let saved: Record<string, string | undefined> = {}

/** Scratch directories this file created, removed once the suite ends. */
const created: string[] = []

/** Create a fresh isolated directory outside the workspace, tracked for cleanup. */
function sandbox(): string {
  /** The directory mkdtemp just created, tracked so the suite can remove it. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-home-guard-"))
  created.push(dir)
  return dir
}

/** The message prefix the workmate row passes, so the refusal text is checked in its shipped spelling. */
const LABEL = "mpd_workmate"

/** The override variable the workmate row passes, likewise part of the shipped refusal text. */
const ALLOW_ENV = "MPD_DSH_WORKMATE_ALLOW_REAL_HOME"

/**
 * Run the guard and return what it threw, or `undefined` when it allowed the mutation.
 *
 * @param root the home-scoped root the mutation would write.
 * @param operation the operation named in a refusal.
 * @returns the thrown value, or `undefined` when nothing was thrown.
 */
function refusalOf(root: string, operation: string): unknown {
  try {
    assertHomeMutationSandboxed({ root, operation, label: LABEL, allowEnv: ALLOW_ENV })
    return undefined
  } catch (e) {
    return e
  }
}

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe("shared HOME-scoped mutation guard (T-43)", () => {
  test("(a) ALLOWED: an isolated boot whose HOME is the sandbox may mutate that sandbox", () => {
    /** The sandbox HOME this arm boots with, used as the row's root's parent. */
    const home = sandbox()
    process.env.HOME = home
    process.env.DSH_HOME = home
    expect(refusalOf(join(home, ".mpd", "workmate"), "rename a workmate")).toBeUndefined()
  })

  test("(a2) ALLOWED: a NORMAL session (no DSH_HOME) is never refused, even toward the real home", () => {
    /** The real home the mutation would land in; only its PATH is compared, nothing is written. */
    const real = realUserHome()
    delete process.env.DSH_HOME
    expect(refusalOf(join(real ?? sandbox(), ".mpd", "workmate"), "rename a workmate")).toBeUndefined()
  })

  test("(b) REFUSED: a root in the REAL home while DSH_HOME marks an isolated boot", () => {
    /** A sandbox boot HOME: a temp dir, which can never be the real user home. */
    const sandboxHome = sandbox()
    /** The real user home, or `undefined` on a host that cannot report one (the guard still refuses). */
    const real = realUserHome()
    process.env.HOME = sandboxHome
    process.env.DSH_HOME = sandboxHome
    /** The root the mutation would write: the REAL library, COMPUTED but never created. */
    const root = join(real ?? sandboxHome, ".mpd", "workmate")
    /** The byte-exact refusal the private workmate copy produced; the shared guard must not change it. */
    const expected = LABEL + ": refusing to rename a workmate inside the REAL library " + root
      + " while DSH_HOME=" + sandboxHome + " marks an isolated/QA boot — set HOME=<sandbox> (T-43), or set "
      + ALLOW_ENV + "=1 to override deliberately"
      + (real === undefined ? " (the real home could not be determined on this host)" : "")
    /** What the guard threw for this mutation. */
    const caught = refusalOf(root, "rename a workmate")
    expect(caught).toBeInstanceOf(HomeGuardRefusal)
    if (!(caught instanceof HomeGuardRefusal)) throw new Error("expected a HomeGuardRefusal")
    expect(caught.code).toBe("real-home-refused")
    expect(caught.status).toBe(403)
    expect(caught.message).toBe(expected)
  })

  test("(b2) REFUSED: HOME absent/empty under an isolated boot (the root is the real library)", () => {
    /** The sandbox boot DSH_HOME, which is what marks the process isolated. */
    const dshHome = sandbox()
    /** The real home, or `undefined` on a host that cannot report one. */
    const real = realUserHome()
    process.env.DSH_HOME = dshHome
    delete process.env.HOME
    /** What the guard threw when HOME could not justify the sandbox. */
    const caught = refusalOf(join(real ?? dshHome, ".mpd", "workmate"), "initialize a workmate")
    expect(caught).toBeInstanceOf(HomeGuardRefusal)
  })

  test("(b3) ALLOWED: the row's documented override (`=1`) short-circuits the refusal", () => {
    /** The sandbox boot HOME, which does not cover the real root this arm aims at. */
    const sandboxHome = sandbox()
    process.env.HOME = sandboxHome
    process.env.DSH_HOME = sandboxHome
    process.env[ALLOW_ENV] = "1"
    expect(refusalOf(join(realUserHome() ?? sandboxHome, ".mpd", "workmate"), "delete a workmate")).toBeUndefined()
  })

  test("(c) REACHABLE from the workmate row's import path: its guard is the shared predicate", () => {
    /** The sandbox boot HOME: allowed, because it covers the row's own `~/.mpd/workmate` root. */
    const sandboxHome = sandbox()
    process.env.HOME = sandboxHome
    process.env.DSH_HOME = sandboxHome
    expect(typeof workmateGuard).toBe("function")
    expect(() => workmateGuard("initialize a workmate")).not.toThrow()
    // Pointing HOME at the real user home makes the row's own root the REAL library, so the row's
    // guard must refuse — and with the adapter's class, proving it delegates to the shared predicate.
    process.env.HOME = realUserHome() ?? ""
    /** What the row's guard threw once its root resolved into the real library. */
    let caught: unknown
    try { workmateGuard("rename a workmate") } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(HomeGuardRefusal)
    if (!(caught instanceof HomeGuardRefusal)) throw new Error("expected a HomeGuardRefusal")
    expect(caught.code).toBe("real-home-refused")
  })
})
