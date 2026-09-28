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

// The four tool names the row must register — the gated list this file asserts against, and the
// same four strings `EXTENSIONS-FOR-AGENTS.md` §1 names as the interface's inspection tools.
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

// Sandbox HOME directories this file created, removed again in afterEach so nothing leaks.
const created: string[] = []
// The real HOME as it was at module load, restored after each test (undefined = it was unset).
const originalHome = process.env.HOME

beforeEach(() => {
  // A fresh sandbox home per test: extension discovery must never read or write the real home.
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
  // Captured stdout lines, in emission order.
  const lines: string[] = []
  // The real console.log, kept so the returned `restore` can put it back even on a failing assert.
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  return { lines, restore: () => { console.log = original } }
}

/**
 * A mounted `mpdDsh` stand-in: it records the registrations made THROUGH it,
 * which is what makes "the row used the mounted adapter" assertable rather than
 * inferred. Its return type names only what the assertions read; the row itself
 * reaches it through `ctx.get("mpdDsh")`, so every member the row calls must
 * exist and answer the same way the real adapter does.
 */
function mountedAdapterStub(): {
  /** The stand-in service `ctx.get("mpdDsh")` resolves to. */
  adapter: {
    capabilities: () => { toolsRegister: boolean; skillsProvider: boolean }
    registerTool: (definition: unknown) => () => void
    registerSkillProvider: (create: unknown) => () => void
    workspaceRoot: () => string
    listSkills: () => Promise<unknown[]>
  }
  /** Tool definitions registered THROUGH the stand-in, in call order. */
  tools: Array<{ name: string }>
  /** Skill-provider factories registered through the stand-in; unused by the assertions. */
  providers: unknown[]
} {
  // Tool definitions the row registered through this stand-in.
  const tools: any[] = []
  // Skill-provider factories the row registered through this stand-in.
  const providers: any[] = []
  // The stand-in service itself: same method names the row calls on a real `mpdDsh`.
  const adapter = {
    capabilities: () => ({ toolsRegister: true, skillsProvider: true }),
    registerTool: (definition: any) => { tools.push(definition); return () => {} },
    registerSkillProvider: (create: any) => { providers.push(create); return () => {} },
    workspaceRoot: () => process.cwd(),
    listSkills: async () => [],
  }
  return { adapter, tools, providers }
}

/** Knobs for the fake ctx: which adapter it resolves, and whether it exposes a logger at all. */
interface FakeCtxOptions {
  /** The value `ctx.get("mpdDsh")` resolves to (undefined = the fallback branch). */
  mounted?: unknown
  /** Omit the logger entirely to prove the warning still reaches stdout. */
  logger?: boolean
}

/**
 * A fake cordis ctx carrying only the seams this row touches, so both arms drive
 * the real `apply`. The return type is deliberately narrow: `ctx` is `unknown`
 * because the test only hands it to `apply(ctx: any)` and never reads through it,
 * while the registration records, the provided-service map and the captured
 * warnings are what the assertions inspect.
 */
function fakeCtx(options: FakeCtxOptions = {}): {
  ctx: unknown
  registered: Array<{ name: string }>
  providers: unknown[]
  provided: Record<string, Record<string, unknown>>
  warnings: string[]
} {
  // Tool definitions landing in the ctx's OWN tools service — the fallback path's fingerprint.
  const registered: any[] = []
  // Skill-provider factories landing in the ctx's own skills service.
  const providers: any[] = []
  // Values published with ctx.provide, keyed by service name (this is where mpdExtensions lands).
  const provided: Record<string, any> = {}
  // Lines the fake logger received; stdout is captured separately, so each sink is counted alone.
  const warnings: string[] = []
  // The fake ctx object: `any` because each arm replaces a different service surface.
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

// Only the ADAPTER FALLBACK lines of a sink, the marker every arm counts per sink.
const fallbackWarnings = (lines: string[]): string[] => lines.filter((line) => line.includes("ADAPTER FALLBACK"))

describe("F1 fallback arm: no mounted mpdDsh", () => {
  test("warns exactly ONCE per apply and names the private adapter identity", async () => {
    // Stdout capture, because this arm counts the warning per sink.
    const stdout = captureStdout()
    // The no-mount ctx: ctx.get("mpdDsh") resolves to undefined, i.e. the fallback branch.
    const fake = fakeCtx()
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
    // Stdout capture; this arm asserts on the provided service, not on the lines.
    const stdout = captureStdout()
    // Same no-mount ctx as the arm above, read back through the service it published.
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
    // Stdout capture; the ctx below deliberately exposes no logger.
    const stdout = captureStdout()
    // A no-mount ctx WITHOUT a logger: stdout must still carry the one warning.
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
    // Stdout capture, the sink a mount lane greps for the boot line.
    const stdout = captureStdout()
    // The mounted stand-in recording what the row registers THROUGH it.
    const stub = mountedAdapterStub()
    // A ctx whose ctx.get("mpdDsh") resolves to that mounted stand-in.
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
    // Stdout capture; this arm asserts on the stand-in's own record, not on the lines.
    const stdout = captureStdout()
    // The stand-in whose record proves which adapter the registrations went through.
    const stub = mountedAdapterStub()
    // A ctx resolving ctx.get("mpdDsh") to that stand-in.
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
  //
  // What a red does and does not mean, so nobody "fixes" it the wrong way:
  //   · the emitter ERASES comments and type annotations, so a comment-only or
  //     annotation-only `src/` edit keeps the committed dist byte-identical and this
  //     arm green;
  //   · any edit the emitter CAN see makes the committed dist stale, and a red here is
  //     then the CORRECT state until integration rebuilds it — the remedy is the
  //     rebuild printed in the message below, never a hand-edit of `dist/**` (a build
  //     product) and never skipping this arm;
  //   · a non-zero status does not by itself prove staleness — the gate is a
  //     subprocess, so `detail` carries its own output and distinguishes a byte
  //     mismatch from a gate that could not run at all.
  test("the committed dists are the byte-identical products of a canonical build (T-62)", () => {
    // Repository root derived from this test file's own URL (`<root>/packages/mpd-ext-plugin/test/`).
    const repoRoot = join(import.meta.dir, "../../..")
    // The canonical gate as a subprocess: its exit status is the verdict, its output the evidence.
    const run = spawnSync("node", [join(repoRoot, "scripts/verify-dist-fresh.ts"), "--only", "mpd-ext-plugin", "--quiet"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    })
    // Gate stdout+stderr, quoted in the assertion message so a red shows WHY it is red.
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
    // The committed artifact read directly: these greps are about its CONTENT, so they
    // stay green even when the freshness arm above is red for a stale build.
    const dist = readFileSync(join(import.meta.dir, "../dist/index.js"), "utf8")
    expect(dist, "dist does not warn on the fallback").toContain("ADAPTER FALLBACK")
    expect(dist, "dist does not carry the mounted identity").toContain("mounted:mpdDsh")
    expect(dist, "dist does not carry the fallback identity").toContain("fallback:createDshAdapter")
    expect(dist, "dist does not expose the identity on the service").toContain("adapterIdentity")
  })
})
