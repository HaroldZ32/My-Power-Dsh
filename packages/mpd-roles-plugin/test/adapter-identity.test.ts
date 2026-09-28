// F1 — the adapter-identity fix (mpd-roles-plugin).
//
// Same two arms as the mpd-ext case, kept in this package so a regression here cannot
// be masked by the other package's suite:
//   · FALLBACK — no mounted `mpdDsh`: `apply` warns EXACTLY ONCE, naming the identity;
//   · MOUNTED  — a mounted `mpdDsh`: NO warning, identity `mounted:mpdDsh`, and the
//     three roster tools are registered THROUGH the mounted adapter, not beside it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ADAPTER_IDENTITY_FALLBACK, ADAPTER_IDENTITY_MOUNTED, apply } from "../src/index.ts"

/** The three roster tools this package must register, named once for every arm below. */
const EXPECTED_TOOLS = ["mpd_roles_list", "mpd_role_spawn", "mpd_role_persona"]

/** Sandbox HOME directories created per test, drained by afterEach so none leaks. */
const created: string[] = []
/** The real HOME value, restored after each test so the sandbox never sticks. */
const originalHome = process.env.HOME

beforeEach(() => {
  /** The per-test sandbox HOME the plugin is pointed at, never the real one. */
  const home = mkdtempSync(join(tmpdir(), "mpd-roles-identity-home-"))
  created.push(home)
  process.env.HOME = home
})

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

/** Capture console.log into a line buffer, returning the buffer and the restore hook. */
function captureStdout(): { lines: string[]; restore: () => void } {
  /** Every line console.log received while the capture is installed. */
  const lines: string[] = []
  /** The real console.log, reinstated by the returned restore hook. */
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  return { lines, restore: () => { console.log = original } }
}

/** A mounted `mpdDsh` stand-in: it records the registrations made THROUGH it. */
function mountedAdapterStub(): {
  adapter: {
    capabilities: () => { toolsRegister: boolean; skillsProvider: boolean }
    registerTool: (definition: { name: string }) => () => void
    spawnAgent: () => Promise<{ structured: { role: string; summary: string }; stopReason: string }>
  }
  tools: Array<{ name: string }>
} {
  /** Definitions registered THROUGH the stub, i.e. through the mounted adapter. */
  const tools: any[] = []
  /** The mounted mpdDsh stand-in ctx.get answers with. */
  const adapter = {
    capabilities: () => ({ toolsRegister: true, skillsProvider: true }),
    registerTool: (definition: any) => { tools.push(definition); return () => {} },
    spawnAgent: async () => ({ structured: { role: "x", summary: "done" }, stopReason: "complete" }),
  }
  return { adapter, tools }
}

/** Knobs for the fake ctx: which adapter it resolves and whether it exposes a logger. */
interface FakeCtxOptions {
  /** The value ctx.get(mpdDsh) answers; undefined models the fallback arm. */
  mounted?: unknown
  /** Whether the fake ctx exposes a logger, so the stdout-only warning path stays reachable. */
  logger?: boolean
}

/** A cordis-shaped ctx stand-in recording every registration, provision and warning. */
function fakeCtx(options: FakeCtxOptions = {}): {
  ctx: Parameters<typeof apply>[0]
  registered: Array<{ name: string }>
  provided: Record<string, { adapterIdentity: unknown; list: () => unknown; get: (key: string) => unknown }>
  warnings: string[]
} {
  /** Definitions that landed in the fake ctx OWN tools service (the fallback surface). */
  const registered: any[] = []
  /** The service map ctx.provide filled, keyed by service name. */
  const provided: Record<string, any> = {}
  /** Lines the fake logger warn received, for the fallback-warning assertion. */
  const warnings: string[] = []
  /** The ctx handed to apply; permissive, so the optional logger can be added below. */
  const ctx: any = {
    tools: { register: (definition: any) => { registered.push(definition); return () => {} } },
    subagents: { start: async () => ({ result: { structured: { role: "x", summary: "done" }, stopReason: "complete" } }) },
    provide: (key: string, value: any) => { provided[key] = value },
    get: (key: string) => (key === "mpdDsh" ? options.mounted : undefined),
  }
  if (options.logger !== false) {
    ctx.logger = { warn: (line: unknown) => { warnings.push(String(line)) }, info: () => {}, error: () => {} }
  }
  return { ctx, registered, provided, warnings }
}

/** Lines carrying the ADAPTER FALLBACK marker, i.e. the fallback own warnings. */
const fallbackWarnings = (lines: string[]): string[] => lines.filter((line) => line.includes("ADAPTER FALLBACK"))

describe("F1 vocabulary (standing pin)", () => {
  // The agreed vocabulary for the identity literals, pinned as LITERALS: every
  // lane greps for these strings, so a rename must fail here, not in a live run.
  test("the two identity literals are the agreed vocabulary", () => {
    expect(ADAPTER_IDENTITY_MOUNTED).toBe("mounted:mpdDsh")
    expect(ADAPTER_IDENTITY_FALLBACK).toBe("fallback:createDshAdapter")
  })
})

describe("F1 fallback arm: no mounted mpdDsh", () => {
  test("warns exactly ONCE per apply and names the private adapter identity", () => {
    /** Captured stdout, restored in finally so a failing assertion cannot leak the patch. */
    const stdout = captureStdout()
    /** The fallback-arm ctx: no mounted mpdDsh, so an adapter must be created. */
    const fake = fakeCtx() // ctx.get("mpdDsh") -> undefined
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(fallbackWarnings(stdout.lines).length).toBe(1)
    expect(fallbackWarnings(fake.warnings).length).toBe(1)
    expect(fallbackWarnings(stdout.lines)[0]).toContain("adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK)

    // The fallback really built a second adapter: the three tools landed in the fake
    // ctx's own tools service, which is the surface `createDshAdapter(ctx)` uses.
    expect(fake.registered.map((definition) => definition.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  test("the fallback identity is assertable on the mpdRoles service field", () => {
    /** Captured stdout for the service-field assertion the fallback arm also makes. */
    const stdout = captureStdout()
    /** A logger-capable ctx with no mounted adapter, so the service reports the fallback identity. */
    const fake = fakeCtx()
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }
    expect(fake.provided.mpdRoles.adapterIdentity).toBe(ADAPTER_IDENTITY_FALLBACK)
    // The service is otherwise the pre-change surface (additive field only).
    expect(typeof fake.provided.mpdRoles.list).toBe("function")
    expect(typeof fake.provided.mpdRoles.get).toBe("function")
  })

  test("a warning reaches stdout even when the ctx exposes no logger", () => {
    /** Captured stdout, since this arm proves the warning reaches it with no logger present. */
    const stdout = captureStdout()
    /** A ctx with NO logger, forcing the warning through console.log instead. */
    const fake = fakeCtx({ logger: false })
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }
    expect(fallbackWarnings(stdout.lines).length).toBe(1)
  })
})

describe("F1 healthy arm: a mounted mpdDsh", () => {
  test("emits NO warning and reports the mounted identity on both surfaces", () => {
    /** Captured stdout, which the healthy arm must keep free of fallback warnings. */
    const stdout = captureStdout()
    /** The mounted adapter stand-in whose registrations prove the wiring. */
    const stub = mountedAdapterStub()
    /** A ctx resolving the mounted stub, i.e. the healthy arm. */
    const fake = fakeCtx({ mounted: stub.adapter })
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(fallbackWarnings(stdout.lines)).toEqual([])
    expect(fake.warnings.filter((line) => line.includes("ADAPTER FALLBACK"))).toEqual([])

    /** The identity banner lines, asserted to number exactly ONE per apply. */
    const identityLines = stdout.lines.filter((line) => line.includes("adapterIdentity="))
    expect(identityLines.length).toBe(1)
    expect(identityLines[0]).toContain("adapterIdentity=" + ADAPTER_IDENTITY_MOUNTED)
    expect(identityLines[0]).not.toContain("fallback:")

    expect(fake.provided.mpdRoles.adapterIdentity).toBe(ADAPTER_IDENTITY_MOUNTED)
  })

  test("the three tools are registered THROUGH the mounted adapter, not beside it", () => {
    /** Captured stdout for the tool-registration arm. */
    const stdout = captureStdout()
    /** The mounted stand-in that must receive all three registrations. */
    const stub = mountedAdapterStub()
    /** A ctx resolving the mounted stub, so only the adapter path is exercised. */
    const fake = fakeCtx({ mounted: stub.adapter })
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(stub.tools.map((definition) => definition.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(fake.registered).toEqual([])
    expect(ADAPTER_IDENTITY_MOUNTED).not.toBe(ADAPTER_IDENTITY_FALLBACK)
  })
})

describe("F1 shipped artifact", () => {
  // T-62 (wave 2, lane A) — the marker greps below prove the dist CONTAINS the fix's
  // strings; they cannot prove the dist is the PRODUCT of the current src. Measured
  // 2026-09-17: with a stale line appended to `dist/index.js` all four greps still
  // pass, so a src-only edit could ship DEAD while this file stayed green.
  //
  // This arm delegates the BYTE comparison to the canonical freshness gate
  // (`scripts/verify-dist-fresh.ts`), which rebuilds the package from `src/` TWICE
  // into a temp dir in the canonical repo-root form and compares byte-for-byte — the
  // same reading `bun run verify:gates` takes. A `--only` filter that matches no
  // target is a zero-subject FAILURE in that script, so a red here can never be a
  // silent skip.
  test("the committed dist is the byte-identical product of a canonical build (T-62)", () => {
    /** The repository root, three directories above this test file. */
    const repoRoot = join(import.meta.dir, "../../..")
    /** The canonical dist-freshness gate, run against this package only and quietly. */
    const run = spawnSync("node", [join(repoRoot, "scripts/verify-dist-fresh.ts"), "--only", "mpd-roles-plugin", "--quiet"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    })
    /** The gate combined output, quoted in the failure message so a red names its cause. */
    const detail = `${run.stdout ?? ""}${run.stderr ?? ""}`
    expect(
      run.status,
      `the committed dist does not match a fresh canonical build of its src — rebuild from the repo root:\n`
        + `  bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js\n${detail}`,
    ).toBe(0)
    expect(detail).toContain("ok: 1/1 targets fresh")
  })

  // The dist-marker discipline stays: it names WHAT the artifact must carry.
  test("the built dist carries the adapter-identity fix", () => {
    /** The committed bundle the harness actually loads, read as text for the marker greps. */
    const dist = readFileSync(join(import.meta.dir, "../dist/index.js"), "utf8")
    expect(dist, "dist does not warn on the fallback").toContain("ADAPTER FALLBACK")
    expect(dist, "dist does not carry the mounted identity").toContain("mounted:mpdDsh")
    expect(dist, "dist does not carry the fallback identity").toContain("fallback:createDshAdapter")
    expect(dist, "dist does not expose the identity on the service").toContain("adapterIdentity")
  })
})
