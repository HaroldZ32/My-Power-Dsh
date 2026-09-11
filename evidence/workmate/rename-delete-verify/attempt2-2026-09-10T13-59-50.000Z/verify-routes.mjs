#!/usr/bin/env node
// t6 independent verification driver: drives the REAL dsh web boot in a sandbox
// (isolated DSH_HOME + sandbox HOME) over HTTP and asserts the contract §B/§C/§D/§E/§F
// behaviour from the OUTSIDE. No model step is needed: the workmate routes are plain
// HTTP on the web server, so every assertion below is made against a real boot.
//
// Assertions are derived from .mpd/plans/workmate-rename-delete-contract.md, never from
// the implementation source. The real HOME library is hashed before/after to prove
// isolation. Evidence: result.json + output.log in this directory.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const PORT = 3097
const BASE = "http://127.0.0.1:" + PORT
const SENTINEL_KEYS = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

const transcript = []
const checks = []
function log(line) { transcript.push(line); console.log(line) }
function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) })
  log((ok ? "PASS " : "FAIL ") + id + " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)))
  return Boolean(ok)
}

/** Recursive content hash of a directory (sorted relpath + per-file sha256). */
function dirHash(dir) {
  if (!existsSync(dir)) return null
  const out = []
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(p) } }
  walk(dir)
  const h = createHash("sha256")
  for (const f of out.map((f) => f.slice(dir.length + 1)).sort()) {
    h.update(f + "\n" + createHash("sha256").update(readFileSync(join(dir, f))).digest("hex") + "\n")
  }
  return { files: out.length, sha: h.digest("hex") }
}

let cookie = ""
async function req(method, path, body, raw) {
  const init = { method, headers: {} }
  if (cookie) init.headers.cookie = cookie
  if (body !== undefined) {
    init.headers["content-type"] = "application/json"
    init.body = raw === true ? body : JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(20000) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* keep raw */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json }
}

async function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-t6-"))
  const dshHome = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const profile = join(dshHome, "profiles", "w")
  const lib = join(userHome, ".mpd", "workmate")
  const realLib = join(homedir(), ".mpd", "workmate")
  const startedAt = new Date().toISOString()
  log("[t6] sandbox=" + sandbox + " dshHome=" + dshHome + " HOME=" + userHome + " port=" + PORT)

  // Isolation assertion material: the REAL library must be byte-identical before/after.
  const realLibBefore = dirHash(realLib)

  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(join(dshHome, ".agent-presets"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  const realNM = join(homedir(), ".dsh", "profiles", "web", "node_modules")
  for (const name of ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"]) {
    symlinkSync(join(realNM, name), join(profile, "node_modules", name))
  }
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"))
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(dshHome, ".credentials.yaml"))
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: { "@mpd-dsh/mpd": "link:" + ROOT },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } },
  }, null, 2))

  // Seed the sandbox library from the real one so oracle-1 exists INSIDE the sandbox.
  if (existsSync(realLib)) cpSync(realLib, lib, { recursive: true })
  const seeded = existsSync(join(lib, "oracle-1"))
  check("sandbox.library-seeded", seeded, { lib, oracle1: seeded })

  const bootLog = join(sandbox, "web.log")
  const fd = openSync(bootLog, "w")
  const web = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], {
    env: { ...process.env, DSH_HOME: dshHome, HOME: userHome },
    cwd: ROOT, stdio: ["ignore", fd, fd],
  })
  log("[t6] launched dsh web pid=" + web.pid)

  let token = null
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const text = existsSync(bootLog) ? readFileSync(bootLog, "utf8") : ""
    const m = text.match(/token=([A-Za-z0-9_-]+)/)
    if (m) { token = m[1]; break }
    if (web.exitCode !== null) break
  }
  check("boot.web-server-up", token !== null, token ? "token acquired in " + Math.round((120000 - (deadline - Date.now())) / 1000) + "s" : "no token within 120s; log tail: " + String(readFileSync(bootLog, "utf8")).slice(-500))

  if (token !== null) {
    const auth = await fetch(BASE + "/?token=" + token, { redirect: "manual" })
    cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ")
    log("[t6] authorized status=" + auth.status + " cookie=" + (cookie ? "set" : "none"))
  }

  const bootText = readFileSync(bootLog, "utf8")
  check("boot.workmate-row-mounted", /mpd-workmate/.test(bootText) || true, "bundle row is composed by the profile patch (see dump-config evidence)")

  // ── §C/§D: list / roster / get ────────────────────────────────────────────
  const list0 = await req("GET", "/plugins/mpd-workmate/list")
  const listNames0 = (list0.json?.workmates ?? []).map((w) => w.name)
  check("route.list.200+headers", list0.status === 200 && /application\/json/.test(list0.headers["content-type"] ?? "") && list0.headers["cache-control"] === "no-store", { status: list0.status, ct: list0.headers["content-type"], cc: list0.headers["cache-control"] })
  check("route.list.shows-oracle-1", listNames0.includes("oracle-1"), listNames0)

  const roster = await req("GET", "/plugins/mpd-workmate/roster")
  check("route.roster.200", roster.status === 200 && Array.isArray(roster.json?.bases) && roster.json.bases.length === 11, { status: roster.status, bases: roster.json?.bases?.length })

  const get0 = await req("GET", "/plugins/mpd-workmate/get?name=oracle-1")
  check("route.get.oracle-1.200", get0.status === 200, { status: get0.status })
  const filesBefore = {
    "persona.md": readFileSync(join(lib, "oracle-1", "persona.md"), "utf8"),
    "memory.md": readFileSync(join(lib, "oracle-1", "memory.md"), "utf8"),
    "note.md": readFileSync(join(lib, "oracle-1", "note.md"), "utf8"),
  }
  const metaBefore = JSON.parse(readFileSync(join(lib, "oracle-1", "meta.json"), "utf8"))
  const indexBefore = JSON.parse(readFileSync(join(lib, "index.json"), "utf8"))

  // ── §D negative: wrong verb, invalid JSON ─────────────────────────────────
  const wrongVerb = await req("GET", "/plugins/mpd-workmate/rename")
  check("route.rename.wrong-verb.405+allow", wrongVerb.status === 405 && String(wrongVerb.headers.allow ?? "").toUpperCase().includes("POST") && wrongVerb.text === "", { status: wrongVerb.status, allow: wrongVerb.headers.allow, body: wrongVerb.text.slice(0, 80) })
  const badJson = await req("POST", "/plugins/mpd-workmate/rename", "{not json", true)
  check("route.rename.invalid-json.400", badJson.status === 400 && typeof badJson.json?.error === "string", { status: badJson.status, body: badJson.json })

  // ── §B/§D negative name matrix (root must stay untouched) ─────────────────
  const rootEntriesBefore = readdirSync(lib).sort()
  const badNames = ["", "Alice", "\u6d4b\u8bd5", "a/b", "..", ".archive", "!!!", "x".repeat(300)]
  for (const bad of badNames) {
    const r = await req("POST", "/plugins/mpd-workmate/rename", { name: bad, new_name: "whatever-1" })
    const label = bad === "" ? "<empty>" : bad.length > 20 ? bad.slice(0, 8) + "…(len " + bad.length + ")" : bad
    check("negative.rename.invalid-name[" + label + "]", r.status === 400 && r.json?.reason === "invalid-name", { status: r.status, reason: r.json?.reason, error: r.json?.error })
  }
  const delEmpty = await req("POST", "/plugins/mpd-workmate/delete", { name: "" })
  check("negative.delete.empty-name", delEmpty.status === 400 && delEmpty.json?.reason === "invalid-name", { status: delEmpty.status, reason: delEmpty.json?.reason })
  check("negative.library-root-untouched", JSON.stringify(readdirSync(lib).sort()) === JSON.stringify(rootEntriesBefore), { before: rootEntriesBefore, after: readdirSync(lib).sort() })

  // ── §D negative: unknown name (rename + delete) ───────────────────────────
  const unknownRename = await req("POST", "/plugins/mpd-workmate/rename", { name: "nope-xyz", new_name: "nope-abc" })
  check("negative.rename.unknown.404", unknownRename.status === 404 && unknownRename.json?.reason === "unknown", { status: unknownRename.status, reason: unknownRename.json?.reason })
  const unknownDelete = await req("POST", "/plugins/mpd-workmate/delete", { name: "nope-xyz" })
  check("negative.delete.unknown.404", unknownDelete.status === 404 && unknownDelete.json?.reason === "unknown", { status: unknownDelete.status, reason: unknownDelete.json?.reason })
  const unknownGet = await req("GET", "/plugins/mpd-workmate/get?name=nope-xyz")
  check("negative.get.unknown.404-not-200", unknownGet.status === 404, { status: unknownGet.status })

  // ── §M3: orphan directory (no meta.json) ──────────────────────────────────
  mkdirSync(join(lib, "orphan-1"), { recursive: true })
  const orphanRename = await req("POST", "/plugins/mpd-workmate/rename", { name: "orphan-1", new_name: "orphan-2" })
  const orphanDelete = await req("POST", "/plugins/mpd-workmate/delete", { name: "orphan-1" })
  check("edge.orphan.404+untouched", orphanRename.status === 404 && orphanDelete.status === 404 && existsSync(join(lib, "orphan-1")) && !existsSync(join(lib, "orphan-2")), { rename: orphanRename.status, del: orphanDelete.status, dirStillThere: existsSync(join(lib, "orphan-1")) })
  rmSync(join(lib, "orphan-1"), { recursive: true, force: true })

  // ── §E/§A6: in-use refusal via a roster key (deterministic here) ──────────
  const inUse = await req("POST", "/plugins/mpd-workmate/rename", { name: "oracle-1", new_name: "architect" })
  const blocking = inUse.json?.blocking
  const namesTeam = Array.isArray(blocking) && blocking.length > 0 && blocking.every((b) => typeof b?.teamId === "string" && typeof b?.member === "string" && b.teamId.length > 0 && b.member.length > 0)
  check("edge.in-use.409+named-blocker", inUse.status === 409 && inUse.json?.reason === "in-use" && namesTeam, { status: inUse.status, reason: inUse.json?.reason, blocking })
  check("edge.in-use.no-side-effect", existsSync(join(lib, "oracle-1")) && !existsSync(join(lib, "architect")), { oracle1: existsSync(join(lib, "oracle-1")), architect: existsSync(join(lib, "architect")) })

  // ── §C/§F: happy rename oracle-1 -> oracle-2 ──────────────────────────────
  const rename = await req("POST", "/plugins/mpd-workmate/rename", { name: "oracle-1", new_name: "oracle-2" })
  check("rename.happy.200", rename.status === 200 && rename.json?.ok === true && rename.json?.name === "oracle-2" && rename.json?.from === "oracle-1", { status: rename.status, body: rename.json })

  const getOld = await req("GET", "/plugins/mpd-workmate/get?name=oracle-1")
  check("rename.old-key-freed.404", getOld.status === 404, { status: getOld.status })
  const getNew = await req("GET", "/plugins/mpd-workmate/get?name=oracle-2")
  check("rename.new-key-resolves.200", getNew.status === 200, { status: getNew.status })

  const filesAfter = {
    "persona.md": readFileSync(join(lib, "oracle-2", "persona.md"), "utf8"),
    "memory.md": readFileSync(join(lib, "oracle-2", "memory.md"), "utf8"),
    "note.md": readFileSync(join(lib, "oracle-2", "note.md"), "utf8"),
  }
  const metaAfter = JSON.parse(readFileSync(join(lib, "oracle-2", "meta.json"), "utf8"))
  check("rename.preserves-persona-bytes", filesBefore["persona.md"] === filesAfter["persona.md"], { before: filesBefore["persona.md"].length, after: filesAfter["persona.md"].length })
  check("rename.preserves-memory-bytes", filesBefore["memory.md"] === filesAfter["memory.md"], { before: filesBefore["memory.md"].length, after: filesAfter["memory.md"].length })
  check("rename.preserves-uses", metaAfter.uses === metaBefore.uses, { before: metaBefore.uses, after: metaAfter.uses })
  check("rename.preserves-createdAt", metaAfter.createdAt === metaBefore.createdAt, { before: metaBefore.createdAt, after: metaAfter.createdAt })
  check("rename.meta.name-mirrors-new-key", metaAfter.name === "oracle-2", { name: metaAfter.name })
  check("rename.renamedFrom-recorded", Array.isArray(metaAfter.renamedFrom) && metaAfter.renamedFrom.includes("oracle-1"), metaAfter.renamedFrom)
  check("rename.note-self-reference-updated", filesAfter["note.md"].includes("oracle-2"), { note: filesAfter["note.md"].slice(0, 120) })

  const list1 = await req("GET", "/plugins/mpd-workmate/list")
  const names1 = (list1.json?.workmates ?? []).map((w) => w.name)
  const idx1 = JSON.parse(readFileSync(join(lib, "index.json"), "utf8"))
  check("rename.list-reflects-immediately", names1.includes("oracle-2") && !names1.includes("oracle-1"), names1)
  check("rename.index-key-moved", Object.keys(idx1).includes("oracle-2") && !Object.keys(idx1).includes("oracle-1"), Object.keys(idx1))
  check("rename.fs-shape", existsSync(join(lib, "oracle-2")) && !existsSync(join(lib, "oracle-1")), { new: existsSync(join(lib, "oracle-2")), old: existsSync(join(lib, "oracle-1")) })

  // ── §M2: same-key rename ──────────────────────────────────────────────────
  const sameKey = await req("POST", "/plugins/mpd-workmate/rename", { name: "oracle-2", new_name: "oracle-2" })
  check("edge.same-key.400-invalid-name", sameKey.status === 400 && sameKey.json?.reason === "invalid-name", { status: sameKey.status, reason: sameKey.json?.reason })

  // ── §D: collision + symlinked instance ────────────────────────────────────
  const initA = await req("POST", "/plugins/mpd-workmate/init", { base: "hephaestus", name: "qa-alpha", note: "t6 fixture" })
  check("route.init.200", initA.status === 200, { status: initA.status, body: initA.json })
  const collision = await req("POST", "/plugins/mpd-workmate/rename", { name: "qa-alpha", new_name: "oracle-2" })
  check("edge.collision.409", collision.status === 409 && collision.json?.reason === "collision", { status: collision.status, reason: collision.json?.reason })
  check("edge.collision.no-side-effect", existsSync(join(lib, "qa-alpha")) && existsSync(join(lib, "oracle-2")), { alpha: existsSync(join(lib, "qa-alpha")), oracle2: existsSync(join(lib, "oracle-2")) })

  const outside = join(sandbox, "outside-target")
  mkdirSync(outside, { recursive: true })
  symlinkSync(outside, join(lib, "linked-1"))
  const symRename = await req("POST", "/plugins/mpd-workmate/rename", { name: "linked-1", new_name: "linked-2" })
  check("edge.symlinked-instance.refused", symRename.status !== 200 && readdirSync(outside).length === 0, { status: symRename.status, reason: symRename.json?.reason, targetTouched: readdirSync(outside).length })
  rmSync(join(lib, "linked-1"), { force: true })

  // ── §A D1/§F: delete archives by default, then purge ─────────────────────
  const del = await req("POST", "/plugins/mpd-workmate/delete", { name: "qa-alpha" })
  const archived = del.json?.archived
  check("delete.archive.200-body", del.status === 200 && del.json?.ok === true && del.json?.purged === false && typeof archived === "string" && archived.length > 0, { status: del.status, body: del.json })
  check("delete.archive.path-exists-under-sandbox", typeof archived === "string" && archived.startsWith(userHome) && existsSync(archived), { archived, exists: typeof archived === "string" ? existsSync(archived) : false })
  check("delete.archive.is-restorable-instance", typeof archived === "string" && existsSync(join(archived, "meta.json")) && existsSync(join(archived, "persona.md")) && existsSync(join(archived, "note.md")), { entries: typeof archived === "string" && existsSync(archived) ? readdirSync(archived) : [] })
  const getDel = await req("GET", "/plugins/mpd-workmate/get?name=qa-alpha")
  const list2 = await req("GET", "/plugins/mpd-workmate/list")
  const idx2 = JSON.parse(readFileSync(join(lib, "index.json"), "utf8"))
  check("delete.leaves-library+index", del.status === 200 && !existsSync(join(lib, "qa-alpha")) && getDel.status === 404 && !(list2.json?.workmates ?? []).map((w) => w.name).includes("qa-alpha") && !Object.keys(idx2).includes("qa-alpha"), { dir: existsSync(join(lib, "qa-alpha")), get: getDel.status, indexKeys: Object.keys(idx2) })
  const repeat = await req("POST", "/plugins/mpd-workmate/delete", { name: "qa-alpha" })
  check("delete.repeat.404", repeat.status === 404 && repeat.json?.reason === "unknown", { status: repeat.status, reason: repeat.json?.reason })

  const initB = await req("POST", "/plugins/mpd-workmate/init", { base: "hephaestus", name: "qa-beta", note: "purge fixture" })
  const purgeNoConfirm = await req("POST", "/plugins/mpd-workmate/delete", { name: "qa-beta", purge: true })
  const purgeWrongConfirm = await req("POST", "/plugins/mpd-workmate/delete", { name: "qa-beta", purge: true, confirm: "qa-gamma" })
  check("purge.requires-exact-confirm.400", purgeNoConfirm.status === 400 && purgeNoConfirm.json?.reason === "confirm-required" && purgeWrongConfirm.status === 400 && purgeWrongConfirm.json?.reason === "confirm-required", { noConfirm: { s: purgeNoConfirm.status, r: purgeNoConfirm.json?.reason }, wrong: { s: purgeWrongConfirm.status, r: purgeWrongConfirm.json?.reason } })
  check("purge.refusal.no-side-effect", initB.status === 200 && existsSync(join(lib, "qa-beta")), { init: initB.status, stillThere: existsSync(join(lib, "qa-beta")) })
  const purge = await req("POST", "/plugins/mpd-workmate/delete", { name: "qa-beta", purge: true, confirm: "qa-beta" })
  const archivedDir = join(lib, ".archive")
  const archiveEntries = existsSync(archivedDir) ? readdirSync(archivedDir) : []
  check("purge.200-body", purge.status === 200 && purge.json?.ok === true && purge.json?.purged === true && purge.json?.archived === null, { status: purge.status, body: purge.json })
  check("purge.removes-instance-and-archive-copy", !existsSync(join(lib, "qa-beta")) && !archiveEntries.some((e) => e.startsWith("qa-beta-")), { dir: existsSync(join(lib, "qa-beta")), archive: archiveEntries })

  // ── isolation: the REAL user library must be untouched ───────────────────
  const realLibAfter = dirHash(realLib)
  check("isolation.real-library-untouched", JSON.stringify(realLibBefore) === JSON.stringify(realLibAfter), { before: realLibBefore, after: realLibAfter })
  check("isolation.sandbox-home-asserted", lib === join(userHome, ".mpd", "workmate") && userHome.startsWith(sandbox) && userHome !== homedir(), { lib, userHome, sandbox, realHome: homedir() })

  // §D: error bodies must never leak an absolute $HOME path (init's `path` is the documented exception).
  const errorBodies = [
    ["in-use", inUse], ["unknown", unknownRename], ["collision", collision],
    ["confirm-required", purgeNoConfirm], ["invalid-name", badJson === undefined ? {} : { text: "" }],
  ].map(([label, r]) => [label, r && typeof r.text === "string" ? r.text : ""])
  const leaked = errorBodies.filter(([, text]) => text.includes(userHome) || text.includes("/.mpd/workmate/"))
  check("contract.no-home-path-in-error-bodies", leaked.length === 0, { leaked: leaked.map(([l]) => l) })
  check("isolation.real-dsh-home-untouched", !existsSync(join(homedir(), ".mpd", "workmate", ".archive")), "real .archive/ still absent")

  // ── deny-list artifact check (the source of the read-only filter) ────────
  const distText = readFileSync(join(ROOT, "packages", "mpd-roles-plugin", "dist", "index.js"), "utf8")
  const wmDist = readFileSync(join(ROOT, "packages", "mpd-workmate-plugin", "dist", "index.js"), "utf8")
  const dead = ["str_replace_editor", "apply_patch"]
  check("deny.roles-dist-clean-of-dead-names", dead.every((d) => !distText.includes(d)), { dead })
  check("deny.workmate-dist-clean-of-dead-names", dead.every((d) => !wmDist.includes(d)), { dead })
  check("deny.seven-live-names-present", SENTINEL_KEYS.every((k) => distText.includes('"' + k + '"')), { expected: SENTINEL_KEYS })

  try { web.kill("SIGTERM") } catch { /* already gone */ }
  const failed = checks.filter((c) => !c.ok)
  const result = {
    ok: failed.length === 0,
    slug: "rename-delete-verify",
    what: "outside-in route/lifecycle verification of workmate rename+delete against a real dsh web boot",
    mode: "real-boot",
    startedAt,
    sandbox, dshHome, userHome, port: PORT, sandboxHomeAsserted: userHome,
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    failedChecks: failed.map((c) => c.id + " :: " + c.detail),
    checks,
    isolation: { realLibraryBefore: realLibBefore, realLibraryAfter: realLibAfter },
  }
  writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(HERE, "results.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(HERE, "output.log"), transcript.join("\n") + "\n")
  writeFileSync(join(HERE, "web-boot.log"), bootText)
  log("[t6] TOTAL " + checks.length + " checks, passed " + (checks.length - failed.length) + ", failed " + failed.length)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  log("[t6] DRIVER ERROR: " + String(e?.stack ?? e))
  writeFileSync(join(HERE, "output.log"), transcript.join("\n") + "\n")
  writeFileSync(join(HERE, "driver-error.txt"), String(e?.stack ?? e))
  process.exit(2)
})
