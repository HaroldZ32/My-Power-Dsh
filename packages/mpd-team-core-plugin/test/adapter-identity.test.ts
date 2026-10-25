// D-06 — the LAST uninstrumented adapter site (mpd-team-core).
//
// `adapterFor` used to resolve `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` by hand, with no identity
// record, so a FALLBACK (a private adapter built beside the tree's, bypassing the one-contact-surface
// rule) left no trace in a boot log. It now returns the shared LAZY facade, so the resolver's own
// one-time identity line lands in this row's log, labelled `mpd-team-core`.
//
// Two arms, both read off a surface the row really writes:
//   · FALLBACK — no mounted `mpdDsh`: EXACTLY ONE `fallback:createDshAdapter` line, carrying this
//     row's label, and the tools land in the ctx's OWN tools registry (what "private adapter" means);
//   · MOUNTED  — a mounted `mpdDsh`: NO fallback line, and every tool registers THROUGH the mount
//     (the ctx's own registry stays empty) — the discriminator a stray second adapter cannot fake.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ADAPTER_IDENTITY_FALLBACK } from "../../mpd-dsh-adapter-plugin/src/index"
import { apply } from "../src/index"

/** The tool names this row registers, i.e. the surface both arms assert on. */
const EXPECTED_TOOLS = ["agent_teams_control", "agent_teams_dispatch", "agent_teams_mail", "agent_teams_plan", "agent_teams_task"]

/** What one arm captured: the ctx's own registry plus the mount's registry. */
interface Capture {
  /** Tool names that landed in the ctx's own `tools` service — the FALLBACK adapter's fingerprint. */
  inCtx: string[]
  /** Tool names that landed in the mounted adapter stub — the MOUNTED path's fingerprint. */
  throughMount: string[]
  /** The cordis context handed to `apply`. */
  ctx: unknown
}

/**
 * Apply the row against a stub context.
 * @param mounted - true to publish the stand-in `mpdDsh` service, false for the fallback branch.
 * @param workspace - the workspace root the row resolves its state and log under.
 * @returns what the apply registered, per sink.
 */
function capture(mounted: boolean, workspace: string): Capture {
  /** Names landing in the ctx's own tools registry. */
  const inCtx: string[] = []
  /** Names landing in the mounted stub's registry. */
  const throughMount: string[] = []
  /** A disposer-returning no-op, standing in for every seam an arm does not read. */
  const noop = (): (() => void) => () => {}
  /** The mounted stand-in: it records only what an assertion reads and no-ops the rest. */
  const mount = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: { name: string }) => { throughMount.push(definition.name); return () => {} }
      if (prop === "workspaceRoot") return () => workspace
      if (prop === "capabilities") return () => ({ toolsRegister: true })
      if (prop === "rowLog") return noop
      return noop
    },
  })
  /** The cordis context: `get` answers the mount (or nothing) and every other seam is inert. */
  const ctx = {
    tools: { register: (definition: { name: string }) => { inCtx.push(definition.name); return () => {} }, get: () => undefined, execute: async () => ({}) },
    commands: { register: () => () => {} },
    get: (name: string) => (name === "mpdDsh" && mounted ? mount : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: noop,
    inject: noop,
    logger: { warn: noop, info: noop, error: noop },
  }
  // The stub is a hand-built subset of the real context, so it is asserted to `never` rather than
  // made to satisfy whatever Context type the seam declares — the assertion is the stub's contract.
  apply(ctx as never)
  return { inCtx, throughMount, ctx }
}

/**
 * Read this row's adapter-identity diagnostics.
 * @param workspace - the workspace root whose `.mpd/logs` the resolver wrote under.
 * @returns the log lines that carry an adapter identity, or `[]` when the file is absent.
 */
function identityLines(workspace: string): string[] {
  try {
    return readFileSync(join(workspace, ".mpd", "logs", "mpd-dsh-adapter.log"), "utf8")
      .split("\n")
      .filter((line) => line.includes("adapterIdentity="))
  } catch {
    return []
  }
}

describe("D-06 — the adapter identity is recorded, once", () => {
  test("no mounted mpdDsh: ONE labelled fallback line and a private adapter in the ctx's own registry", () => {
    /** This arm's sandbox workspace, which also roots the row log. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-identity-fallback-"))
    /** The ambient root this arm replaces, restored before it returns. */
    const saved = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** What this apply registered, per sink. */
      const captured = capture(false, workspace)
      /** The identity lines the resolver wrote. */
      const lines = identityLines(workspace)
      expect(lines.filter((line) => line.includes(ADAPTER_IDENTITY_FALLBACK)).length).toBe(1)
      // Labelled: a boot log must name WHICH row fell back, not just that something did.
      expect(lines.find((line) => line.includes(ADAPTER_IDENTITY_FALLBACK))).toContain("mpd-team-core")
      // The private adapter's fingerprint: the ctx's own registry received the tool surface.
      expect(captured.inCtx.sort()).toEqual(EXPECTED_TOOLS)
      expect(captured.throughMount).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = saved
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("a mounted mpdDsh: NO fallback line, and every tool registers through the mount", () => {
    /** This arm's sandbox workspace, which also roots the row log. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-identity-mounted-"))
    /** The ambient root this arm replaces, restored before it returns. */
    const saved = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      // The mounted service: `probeMpdDsh`'s strict read gets it back, so no fallback is needed.
      /** What this apply registered, per sink. */
      const captured = capture(true, workspace)
      /** The identity lines the resolver wrote. */
      const lines = identityLines(workspace)
      expect(lines.filter((line) => line.includes(ADAPTER_IDENTITY_FALLBACK))).toEqual([])
      // The mount's registry got the surface, and the ctx's own registry stayed empty.
      expect(captured.throughMount.sort()).toEqual(EXPECTED_TOOLS)
      expect(captured.inCtx).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = saved
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
