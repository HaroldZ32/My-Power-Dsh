#!/usr/bin/env node
// t10 INDEPENDENT verification — the adapter-identity arms, driven by the VERIFIER.
//
// This is not a re-run of the authors' test. It imports the SHIPPED `dist/index.js` of both
// plugins (what the packer ships and the harness loads, not `src/`), builds its own fake cordis
// ctx, and asserts the two arms on readings it takes itself:
//
//   FALLBACK — `ctx.get("mpdDsh")` resolves to undefined: `apply` must warn EXACTLY ONCE PER
//              APPLY and the warning must name `adapterIdentity=fallback:createDshAdapter`;
//              the service the row provides must report the same identity.
//   MOUNTED  — a stand-in `mpdDsh` that RECORDS what is registered through it: NO warning, the
//              identity reads `mounted:mpdDsh`, and the four inspection tools must arrive
//              THROUGH the mounted adapter. That last point is the discriminator: a second,
//              private adapter would register them into `ctx.tools` instead and the identity
//              field alone would not notice.
//
// Usage: node arms-adapter-identity.mjs [--json-out <path>]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const PREFIX = "[t10-arms]"

const EXT_DIST = join(repoRoot, "packages", "mpd-ext-plugin", "dist", "index.js")
const ROLES_DIST = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")

const ext = await import(EXT_DIST)
const roles = await import(ROLES_DIST)

const EXPECTED_TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

// Sandbox HOME + cwd so a probe never reads or writes the real home.
const home = mkdtempSync(join(tmpdir(), "t10-arms-home-"))
const workspace = mkdtempSync(join(tmpdir(), "t10-arms-ws-"))
const originalHome = process.env.HOME
const originalCwd = process.cwd()
process.env.HOME = home
process.chdir(workspace)

/** A stand-in mounted adapter: it records every registration made THROUGH it. */
function mountedStub() {
  const throughTools = []
  const throughProviders = []
  return {
    throughTools,
    throughProviders,
    adapter: {
      capabilities: () => ({ toolsRegister: true, skillsProvider: true, subagents: false, agentPresets: false, internalToolCalls: false }),
      registerTool: (definition) => { throughTools.push(definition?.name); return () => {} },
      registerSkillProvider: (create) => { throughProviders.push(create); return () => {} },
      workspaceRoot: () => workspace,
      listSkills: async () => []
    }
  }
}

/** A ctx built here, independently: `mpdDsh` resolves to `mounted` (undefined = fallback). */
function makeCtx({ mounted, withLogger = true } = {}) {
  const warnings = []
  const viaCtxTools = []
  const provided = {}
  const ctx = {
    tools: {
      register: (definition) => { viaCtxTools.push(definition?.name); return () => {} },
      guard: () => () => {},
      get: () => undefined,
      execute: async () => ({})
    },
    skills: { registerProvider: () => () => {}, list: async () => [] },
    provide: (key, value) => { provided[key] = value },
    get: (key) => (key === "mpdDsh" ? mounted : undefined)
  }
  if (withLogger) ctx.logger = { warn: (line) => warnings.push(String(line)), info: () => {}, error: () => {} }
  return { ctx, warnings, viaCtxTools, provided }
}

async function drive(label, apply, { mounted } = {}) {
  const captured = []
  const originalLog = console.log
  const stub = mounted ? mountedStub() : null
  const made = makeCtx({ mounted: stub?.adapter })
  console.log = (...args) => { captured.push(args.map(String).join(" ")) }
  let threw = null
  try {
    await apply(made.ctx)
  } catch (error) {
    threw = error
  } finally {
    console.log = originalLog
  }
  const fallbackLines = made.warnings.filter((l) => l.includes("ADAPTER FALLBACK"))
  const fallbackStdout = captured.filter((l) => l.includes("ADAPTER FALLBACK"))
  return {
    label, threw: threw ? String(threw?.message ?? threw) : null,
    warnings: made.warnings, fallbackLines, fallbackStdout, stdout: captured,
    viaCtxTools: made.viaCtxTools, stub, provided: made.provided
  }
}

// ---------------------------------------------------------------- mpd-ext
const extFallback = await drive("mpd-ext fallback", ext.apply)
check("ext.fallback.apply-did-not-throw", extFallback.threw === null, extFallback.threw ?? "no throw")
check("ext.fallback.warns-exactly-once", extFallback.fallbackLines.length === 1, "ADAPTER FALLBACK warnings: " + extFallback.fallbackLines.length)
check("ext.fallback.warning-names-identity", extFallback.fallbackLines.some((l) => l.includes("adapterIdentity=" + ext.ADAPTER_IDENTITY_FALLBACK)), extFallback.fallbackLines[0] ?? "(none)")
check("ext.fallback.service-identity", extFallback.provided.mpdExtensions?.adapterIdentity === ext.ADAPTER_IDENTITY_FALLBACK, String(extFallback.provided.mpdExtensions?.adapterIdentity))
check("ext.fallback.identity-constant-shape", ext.ADAPTER_IDENTITY_FALLBACK === "fallback:createDshAdapter" && ext.ADAPTER_IDENTITY_MOUNTED === "mounted:mpdDsh", ext.ADAPTER_IDENTITY_FALLBACK + " / " + ext.ADAPTER_IDENTITY_MOUNTED)

const extMounted = await drive("mpd-ext mounted", ext.apply, { mounted: true })
check("ext.mounted.apply-did-not-throw", extMounted.threw === null, extMounted.threw ?? "no throw")
check("ext.mounted.no-warning", extMounted.fallbackLines.length === 0, "ADAPTER FALLBACK warnings: " + extMounted.fallbackLines.length)
check("ext.mounted.service-identity", extMounted.provided.mpdExtensions?.adapterIdentity === ext.ADAPTER_IDENTITY_MOUNTED, String(extMounted.provided.mpdExtensions?.adapterIdentity))
check("ext.mounted.boot-line-carries-identity", extMounted.stdout.some((l) => l.includes("adapterIdentity=" + ext.ADAPTER_IDENTITY_MOUNTED)), extMounted.stdout.find((l) => l.includes("adapterIdentity=")) ?? "(no line)")
const extThrough = (extMounted.stub?.throughTools ?? []).sort()
check("ext.mounted.four-tools-through-mounted-adapter", EXPECTED_TOOLS.every((t) => extThrough.includes(t)), JSON.stringify(extThrough))
check("ext.mounted.no-second-adapter", extMounted.viaCtxTools.length === 0, "registrations that bypassed the mounted adapter: " + JSON.stringify(extMounted.viaCtxTools))

// ---------------------------------------------------------------- mpd-roles
const rolesFallback = await drive("mpd-roles fallback", roles.apply)
check("roles.fallback.apply-did-not-throw", rolesFallback.threw === null, rolesFallback.threw ?? "no throw")
check("roles.fallback.warns-exactly-once", rolesFallback.fallbackLines.length === 1, "ADAPTER FALLBACK warnings: " + rolesFallback.fallbackLines.length)
check("roles.fallback.warning-names-identity", rolesFallback.fallbackLines.some((l) => l.includes("adapterIdentity=" + roles.ADAPTER_IDENTITY_FALLBACK)), rolesFallback.fallbackLines[0] ?? "(none)")
check("roles.fallback.service-identity", rolesFallback.provided.mpdRoles?.adapterIdentity === roles.ADAPTER_IDENTITY_FALLBACK, String(rolesFallback.provided.mpdRoles?.adapterIdentity))

const rolesMounted = await drive("mpd-roles mounted", roles.apply, { mounted: true })
check("roles.mounted.apply-did-not-throw", rolesMounted.threw === null, rolesMounted.threw ?? "no throw")
check("roles.mounted.no-warning", rolesMounted.fallbackLines.length === 0, "ADAPTER FALLBACK warnings: " + rolesMounted.fallbackLines.length)
check("roles.mounted.service-identity", rolesMounted.provided.mpdRoles?.adapterIdentity === roles.ADAPTER_IDENTITY_MOUNTED, String(rolesMounted.provided.mpdRoles?.adapterIdentity))
check("roles.mounted.boot-line-carries-identity", rolesMounted.stdout.some((l) => l.includes("adapterIdentity=" + roles.ADAPTER_IDENTITY_MOUNTED)), rolesMounted.stdout.find((l) => l.includes("adapterIdentity=")) ?? "(no line)")
check("roles.mounted.no-second-adapter", rolesMounted.viaCtxTools.length === 0, "registrations that bypassed the mounted adapter: " + JSON.stringify(rolesMounted.viaCtxTools))

process.env.HOME = originalHome
process.chdir(originalCwd)
rmSync(home, { recursive: true, force: true })
rmSync(workspace, { recursive: true, force: true })

for (const c of checks) console.log(PREFIX + " " + (c.ok ? "PASS" : "FAIL") + " " + c.id + " :: " + c.detail)
const failed = checks.filter((c) => !c.ok)
console.log(PREFIX + " " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (checks.length - failed.length) + "/" + checks.length + " checks")

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--json-out")
if (outIdx >= 0) {
  const out = resolve(argv[outIdx + 1])
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({
    driver: "arms-adapter-identity.mjs",
    imports: { ext: EXT_DIST, roles: ROLES_DIST, note: "the SHIPPED dist artifacts, not src/" },
    checks,
    raw: {
      extFallback: { warnings: extFallback.warnings, stdout: extFallback.stdout, service: extFallback.provided.mpdExtensions?.adapterIdentity ?? null },
      extMounted: { warnings: extMounted.warnings, stdout: extMounted.stdout, throughMountedAdapter: extThrough, bypassingCtx: extMounted.viaCtxTools },
      rolesFallback: { warnings: rolesFallback.warnings, stdout: rolesFallback.stdout, service: rolesFallback.provided.mpdRoles?.adapterIdentity ?? null },
      rolesMounted: { warnings: rolesMounted.warnings, stdout: rolesMounted.stdout, bypassingCtx: rolesMounted.viaCtxTools }
    }
  }, null, 2) + "\n")
  console.log(PREFIX + " raw readings written to " + out)
}
process.exit(failed.length === 0 ? 0 : 1)
