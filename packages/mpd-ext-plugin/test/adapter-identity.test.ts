// F1 — the adapter-identity fix (mpd-ext-plugin).
//
// Two arms, both asserted on a surface a lane can read (never on prose):
//   · FALLBACK — no mounted `mpdDsh`: `apply` warns EXACTLY ONCE, the warning names
//     the resolved identity, and the `mpdExtensions.adapterIdentity` field reports it;
//   · MOUNTED  — a mounted `mpdDsh`: NO warning, the identity reads `mounted:mpdDsh`,
//     and the four tools are registered THROUGH the mounted adapter (the discriminator:
//     a private adapter would have registered them into `ctx.tools` instead).
//
// The healthy arm is what keeps "one contact surface" checkable: the mounted stub
// records its own registrations, so a stray second adapter cannot pass silently.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ADAPTER_IDENTITY_FALLBACK, ADAPTER_IDENTITY_MOUNTED, apply } from "../src/index.ts"
// The sibling row's constants, imported by the TEST only: the vocabulary pin below
// asserts the two packages agree, so one package cannot rename a literal alone.
import {
  ADAPTER_IDENTITY_FALLBACK as ROLES_IDENTITY_FALLBACK,
  ADAPTER_IDENTITY_MOUNTED as ROLES_IDENTITY_MOUNTED,
} from "../../mpd-roles-plugin/src/index.ts"

const EXPECTED_TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]

describe("F1 vocabulary (standing pin)", () => {
  // The agreed vocabulary, pinned as LITERALS: every lane greps these strings, so a
  // rename must fail here rather than in a live run.
  test("the two identity literals are the agreed vocabulary", () => {
    expect(ADAPTER_IDENTITY_MOUNTED).toBe("mounted:mpdDsh")
    expect(ADAPTER_IDENTITY_FALLBACK).toBe("fallback:createDshAdapter")
  })

  test("the sibling row reports the SAME vocabulary (cross-package equality)", () => {
    expect(ROLES_IDENTITY_MOUNTED).toBe(ADAPTER_IDENTITY_MOUNTED)
    expect(ROLES_IDENTITY_FALLBACK).toBe(ADAPTER_IDENTITY_FALLBACK)
  })
})

const created: string[] = []
const originalHome = process.env.HOME

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "mpd-ext-identity-home-"))
  created.push(home)
  process.env.HOME = home
})

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

/** Capture what the row writes to stdout, and put it back afterwards. */
function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  return { lines, restore: () => { console.log = original } }
}

/** A mounted `mpdDsh` stand-in: it records the registrations made THROUGH it. */
function mountedAdapterStub() {
  const tools: any[] = []
  const providers: any[] = []
  const adapter = {
    capabilities: () => ({ toolsRegister: true, skillsProvider: true }),
    registerTool: (definition: any) => { tools.push(definition); return () => {} },
    registerSkillProvider: (create: any) => { providers.push(create); return () => {} },
    workspaceRoot: () => process.cwd(),
    listSkills: async () => [],
  }
  return { adapter, tools, providers }
}

interface FakeCtxOptions {
  /** The value `ctx.get("mpdDsh")` resolves to (undefined = the fallback branch). */
  mounted?: unknown
  /** Omit the logger entirely to prove the warning still reaches stdout. */
  logger?: boolean
}

function fakeCtx(options: FakeCtxOptions = {}) {
  const registered: any[] = []
  const providers: any[] = []
  const provided: Record<string, any> = {}
  const warnings: string[] = []
  const ctx: any = {
    tools: { register: (definition: any) => { registered.push(definition); return () => {} }, guard: () => () => {}, get: () => undefined, execute: async () => ({}) },
    skills: { registerProvider: (create: any) => { providers.push(create); return () => {} }, list: async () => [] },
    provide: (key: string, value: any) => { provided[key] = value },
    get: (key: string) => (key === "mpdDsh" ? options.mounted : undefined),
  }
  if (options.logger !== false) {
    ctx.logger = { warn: (line: unknown) => { warnings.push(String(line)) }, info: () => {}, error: () => {} }
  }
  return { ctx, registered, providers, provided, warnings }
}

const fallbackWarnings = (lines: string[]): string[] => lines.filter((line) => line.includes("ADAPTER FALLBACK"))

describe("F1 fallback arm: no mounted mpdDsh", () => {
  test("warns exactly ONCE per apply and names the private adapter identity", async () => {
    const stdout = captureStdout()
    const fake = fakeCtx() // ctx.get("mpdDsh") -> undefined
    try {
      await apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    // Exactly one warning, from the one emission the fix adds (it is written to
    // stdout AND the logger, so count it per sink, never across sinks).
    expect(fallbackWarnings(stdout.lines).length).toBe(1)
    expect(fallbackWarnings(fake.warnings).length).toBe(1)
    expect(fallbackWarnings(stdout.lines)[0]).toContain("adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK)

    // The fallback really built a second adapter: the four tools landed in the
    // fake ctx's own tools service, which is what `createDshAdapter(ctx)` registers
    // through.
    expect(fake.registered.map((definition) => definition.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  test("the fallback identity is assertable on the mpdExtensions service field", async () => {
    const stdout = captureStdout()
    const fake = fakeCtx()
    try {
      await apply(fake.ctx)
    } finally {
      stdout.restore()
    }
    expect(fake.provided.mpdExtensions.adapterIdentity).toBe(ADAPTER_IDENTITY_FALLBACK)
    // The service is otherwise the pre-change surface (additive field only).
    for (const key of ["apiVersion", "register", "list", "describe", "flows", "flow"]) {
      expect(fake.provided.mpdExtensions[key]).toBeDefined()
    }
  })

  test("a warning reaches stdout even when the ctx exposes no logger", async () => {
    const stdout = captureStdout()
    const fake = fakeCtx({ logger: false })
    try {
      await apply(fake.ctx)
    } finally {
      stdout.restore()
    }
    expect(fallbackWarnings(stdout.lines).length).toBe(1)
  })
})

describe("F1 healthy arm: a mounted mpdDsh", () => {
  test("emits NO warning and reports the mounted identity on both surfaces", async () => {
    const stdout = captureStdout()
    const stub = mountedAdapterStub()
    const fake = fakeCtx({ mounted: stub.adapter })
    try {
      await apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(fallbackWarnings(stdout.lines)).toEqual([])
    expect(fake.warnings.filter((line) => line.includes("ADAPTER FALLBACK"))).toEqual([])

    // The boot line carries the identity a mount lane greps for.
    const identityLines = stdout.lines.filter((line) => line.includes("adapterIdentity="))
    expect(identityLines.length).toBe(1)
    expect(identityLines[0]).toContain("adapterIdentity=" + ADAPTER_IDENTITY_MOUNTED)
    expect(identityLines[0]).not.toContain("fallback:")

    expect(fake.provided.mpdExtensions.adapterIdentity).toBe(ADAPTER_IDENTITY_MOUNTED)
  })

  test("the four tools are registered THROUGH the mounted adapter, not beside it", async () => {
    const stdout = captureStdout()
    const stub = mountedAdapterStub()
    const fake = fakeCtx({ mounted: stub.adapter })
    try {
      await apply(fake.ctx)
    } finally {
      stdout.restore()
    }

    expect(stub.tools.map((definition) => definition.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
    // Nothing was registered through a second, privately built adapter.
    expect(fake.registered).toEqual([])
    // And the two identities are genuinely different values, so the assertion above
    // cannot pass by comparing one string with itself.
    expect(ADAPTER_IDENTITY_MOUNTED).not.toBe(ADAPTER_IDENTITY_FALLBACK)
  })
})

describe("F1 shipped artifact", () => {
  // T-62 (wave 2, lane A) — the marker greps below prove the dist CONTAINS the fix's
  // strings; they cannot prove the dist is the PRODUCT of the current src. Measured
  // 2026-09-17: with a stale line appended to `dist/index.js` (and `dist/sdk.js`) all
  // four greps still pass, so a src-only edit could ship DEAD while this file stayed
  // green.
  //
  // This arm delegates the BYTE comparison to the canonical freshness gate, which
  // rebuilds EVERY entry of this package (`src/index.ts` → `dist/index.js` and
  // `src/sdk.ts` → `dist/sdk.js`, read from `package.json`) into a temp dir in the
  // canonical repo-root form and compares byte-for-byte. A `--only` filter matching no
  // target is a zero-subject FAILURE there, so a red here is never a silent skip.
  test("the committed dists are the byte-identical products of a canonical build (T-62)", () => {
    const repoRoot = join(import.meta.dir, "../../..")
    const run = spawnSync("node", [join(repoRoot, "scripts/verify-dist-fresh.mjs"), "--only", "mpd-ext-plugin", "--quiet"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    })
    const detail = `${run.stdout ?? ""}${run.stderr ?? ""}`
    expect(
      run.status,
      `a committed dist does not match a fresh canonical build of its src — rebuild from the repo root:\n`
        + `  bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js\n`
        + `  bun build packages/mpd-ext-plugin/src/sdk.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/sdk.js\n${detail}`,
    ).toBe(0)
    expect(detail).toContain("ok: 2/2 targets fresh")
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
