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

const EXPECTED_TOOLS = ["mpd_roles_list", "mpd_role_spawn", "mpd_role_persona"]

const created: string[] = []
const originalHome = process.env.HOME

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "mpd-roles-identity-home-"))
  created.push(home)
  process.env.HOME = home
})

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  return { lines, restore: () => { console.log = original } }
}

/** A mounted `mpdDsh` stand-in: it records the registrations made THROUGH it. */
function mountedAdapterStub() {
  const tools: any[] = []
  const adapter = {
    capabilities: () => ({ toolsRegister: true, skillsProvider: true }),
    registerTool: (definition: any) => { tools.push(definition); return () => {} },
    spawnAgent: async () => ({ structured: { role: "x", summary: "done" }, stopReason: "complete" }),
  }
  return { adapter, tools }
}

interface FakeCtxOptions {
  mounted?: unknown
  logger?: boolean
}

function fakeCtx(options: FakeCtxOptions = {}) {
  const registered: any[] = []
  const provided: Record<string, any> = {}
  const warnings: string[] = []
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
    const stdout = captureStdout()
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
    const stdout = captureStdout()
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
    const stdout = captureStdout()
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
    const stdout = captureStdout()
    const stub = mountedAdapterStub()
    const fake = fakeCtx({ mounted: stub.adapter })
    try {
      apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(fallbackWarnings(stdout.lines)).toEqual([])
    expect(fake.warnings.filter((line) => line.includes("ADAPTER FALLBACK"))).toEqual([])

    const identityLines = stdout.lines.filter((line) => line.includes("adapterIdentity="))
    expect(identityLines.length).toBe(1)
    expect(identityLines[0]).toContain("adapterIdentity=" + ADAPTER_IDENTITY_MOUNTED)
    expect(identityLines[0]).not.toContain("fallback:")

    expect(fake.provided.mpdRoles.adapterIdentity).toBe(ADAPTER_IDENTITY_MOUNTED)
  })

  test("the three tools are registered THROUGH the mounted adapter, not beside it", () => {
    const stdout = captureStdout()
    const stub = mountedAdapterStub()
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
  // (`scripts/verify-dist-fresh.mjs`), which rebuilds the package from `src/` TWICE
  // into a temp dir in the canonical repo-root form and compares byte-for-byte — the
  // same reading `bun run verify:gates` takes. A `--only` filter that matches no
  // target is a zero-subject FAILURE in that script, so a red here can never be a
  // silent skip.
  test("the committed dist is the byte-identical product of a canonical build (T-62)", () => {
    const repoRoot = join(import.meta.dir, "../../..")
    const run = spawnSync("node", [join(repoRoot, "scripts/verify-dist-fresh.mjs"), "--only", "mpd-roles-plugin", "--quiet"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    })
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
    const dist = readFileSync(join(import.meta.dir, "../dist/index.js"), "utf8")
    expect(dist, "dist does not warn on the fallback").toContain("ADAPTER FALLBACK")
    expect(dist, "dist does not carry the mounted identity").toContain("mounted:mpdDsh")
    expect(dist, "dist does not carry the fallback identity").toContain("fallback:createDshAdapter")
    expect(dist, "dist does not expose the identity on the service").toContain("adapterIdentity")
  })
})
