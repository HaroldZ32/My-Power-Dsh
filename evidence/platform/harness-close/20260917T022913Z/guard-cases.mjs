#!/usr/bin/env bun
// guard-cases.mjs — t23 acceptance 2: the T-43 real-home guard is proven by ONE POSITIVE and TWO
// NEGATIVE cases, run against the plugin's real source (bun executes the TS directly).
//
//   NEGATIVE 1  isolated boot + HOME=<sandbox>  -> the mutation is ALLOWED (normal QA shape)
//   NEGATIVE 2  normal session (no DSH_HOME)    -> the mutation is ALLOWED (a user session is never affected)
//   POSITIVE    isolated boot + HOME unset      -> the mutation is REFUSED with `real-home-refused`,
//                                                 and the REAL library is untouched (listed before/after)
//   OVERRIDE    the same isolated shape + MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1 -> the guard itself does
//               not throw (checked by calling the pure assertion, so the real library is never written)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const REPO = "/root/dshProj/my-power-dsh"
const plugin = await import(pathToFileURL(join(REPO, "packages", "mpd-workmate-plugin", "src", "index.ts")).href)
const { assertMutationSandboxed, renameWorkmate, WORKMATE_ALLOW_REAL_HOME_ENV } = plugin

const results = []
const record = (id, ok, detail) => { results.push({ id, ok, detail }); console.log("[" + (ok ? "PASS" : "FAIL") + "] " + id + " — " + detail) }

function fixture(home, key) {
  const wm = join(home, ".mpd", "workmate")
  const dir = join(wm, key)
  mkdirSync(dir, { recursive: true })
  const meta = {
    name: key, baseId: "oracle", baseName: "Architect", description: "fixture", provider: "deepseek-official", model: "deepseek-chat",
    readonly: false, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", uses: 0, lastTask: null, renamedFrom: [],
  }
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), "persona\n")
  writeFileSync(join(dir, "memory.md"), "")
  writeFileSync(join(dir, "note.md"), "note\n")
  writeFileSync(join(wm, "index.json"), JSON.stringify({ [key]: { name: key, baseId: "oracle", baseName: "Architect", uses: 0, updatedAt: meta.updatedAt } }, null, 2) + "\n")
  return { wm, dir }
}

const tmp = mkdtempSync(join(tmpdir(), "t43-guard-"))
const realRoot = join(homedir(), ".mpd", "workmate")
const realBefore = existsSync(realRoot) ? readdirSync(realRoot).sort() : null
const envBefore = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME, ALLOW: process.env[WORKMATE_ALLOW_REAL_HOME_ENV] }

try {
  // NEGATIVE 1 — isolated boot with a sandboxed HOME (the sanctioned QA shape).
  {
    const home = join(tmp, "sandbox-home-1")
    const { wm } = fixture(home, "oracle-one")
    process.env.HOME = home
    process.env.DSH_HOME = join(tmp, "dsh-home")
    delete process.env[WORKMATE_ALLOW_REAL_HOME_ENV]
    const out = renameWorkmate("oracle-one", "oracle-renamed", [])
    const moved = existsSync(join(wm, "oracle-renamed", "meta.json")) && !existsSync(join(wm, "oracle-one"))
    record("negative-1 isolated boot + HOME=<sandbox> -> allowed", out?.ok === true && moved, "renamed " + JSON.stringify(out))
  }

  // NEGATIVE 2 — a normal session: no DSH_HOME at all.
  {
    const home = join(tmp, "sandbox-home-2")
    const { wm } = fixture(home, "oracle-two")
    process.env.HOME = home
    delete process.env.DSH_HOME
    const out = renameWorkmate("oracle-two", "oracle-two-renamed", [])
    const moved = existsSync(join(wm, "oracle-two-renamed", "meta.json"))
    record("negative-2 normal session (DSH_HOME unset) -> allowed", out?.ok === true && moved, "renamed " + JSON.stringify(out))
  }

  // POSITIVE — isolated boot whose HOME is gone: the library would BE the real one, so it is refused.
  {
    process.env.HOME = ""            // empty == absent for homeDir() (it falls back to the real home)
    process.env.DSH_HOME = join(tmp, "dsh-home")
    let refused = null
    try { renameWorkmate("whatever", "whatever-2", []) } catch (error) { refused = error }
    const code = refused?.code ?? refused?.name ?? null
    const message = String(refused?.message ?? "")
    const untouched = (existsSync(realRoot) ? readdirSync(realRoot).sort() : null)
    const sameReal = JSON.stringify(untouched) === JSON.stringify(realBefore)
    record("positive isolated boot + HOME unset -> refused, real library untouched",
      refused !== null && String(code) === "real-home-refused" && message.includes("T-43") && sameReal,
      "code=" + String(code) + " realLibraryUnchanged=" + sameReal)
  }

  // OVERRIDE — the documented escape hatch releases the guard (pure assertion, no fs effect).
  {
    const before = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME }
    process.env[WORKMATE_ALLOW_REAL_HOME_ENV] = "1"
    let threw = null
    try { assertMutationSandboxed("probe only") } catch (error) { threw = error }
    process.env.HOME = before.HOME
    process.env.DSH_HOME = before.DSH_HOME
    delete process.env[WORKMATE_ALLOW_REAL_HOME_ENV]
    record("override " + WORKMATE_ALLOW_REAL_HOME_ENV + "=1 -> guard does not throw", threw === null, threw === null ? "released" : String(threw))
  }
} finally {
  if (envBefore.HOME === undefined) delete process.env.HOME; else process.env.HOME = envBefore.HOME
  if (envBefore.DSH_HOME === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = envBefore.DSH_HOME
  if (envBefore.ALLOW === undefined) delete process.env[WORKMATE_ALLOW_REAL_HOME_ENV]; else process.env[WORKMATE_ALLOW_REAL_HOME_ENV] = envBefore.ALLOW
  rmSync(tmp, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
writeFileSync(join(import.meta.dir, "guard-cases.result.json"), JSON.stringify({ ok: failed.length === 0, cases: results }, null, 2) + "\n")
console.log("[guard-cases] " + (results.length - failed.length) + "/" + results.length + " cases passed — " + (failed.length === 0 ? "PASS" : "FAIL"))
process.exit(failed.length === 0 ? 0 : 1)
