// t12 (Reviewer) — INDEPENDENT attack on the workmate alias removal (C1/C2/C3/C4), written by the
// review lane. It drives the REAL workmate plugin (`apply`) with a fake ctx whose `mpdRoles` service
// is fed from the REAL roster data (`ROLES`) — including the legacy `get(id)` lookup, so the removed
// omo-id path would still resolve if any code reached for it.
//
// HOME is redirected to a temp sandbox (T-43); nothing under the real home is touched.
//
// Run: bun evidence/model-slots/review/<ts>/driver/t12-workmate-attack.mjs
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROLES } from "../../../../../packages/mpd-roles-plugin/src/roles.data.ts"

const checks = []
const record = (id, ok, detail, extra = {}) => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail), ...extra })
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`)
}

const sandbox = mkdtempSync(join(tmpdir(), "t12-workmate-"))
process.env.HOME = sandbox
delete process.env.DSH_HOME

// The real roster, projected the way the mpdRoles service serves it (id + name + chain + persona).
const roster = ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain, persona: `You are the ${r.name}.` }))
const rolesService = {
  list: () => roster.map((r) => ({ ...r })),
  get: (k) => {
    const byId = roster.find((r) => r.id === String(k))
    if (byId) return { ...byId }
    const byName = roster.find((r) => r.name.toLowerCase() === String(k).toLowerCase())
    return byName ? { ...byName } : null
  },
}

const tools = []
const routes = new Map()
const ctx = {
  get: (k) => (k === "mpdRoles" ? rolesService : k === "webServer" ? { register: (h) => { routes.set(h.path, h); return () => {} } } : undefined),
  tools: { register: (d) => tools.push(d) },
  subagents: { start: async () => ({ result: { structured: {}, stopReason: "complete" } }) },
  provide: () => {},
  effect: (fn) => { fn(); return () => {} },
}
const { apply } = await import("../../../../../packages/mpd-workmate-plugin/src/index.ts")
apply(ctx)

const byName = (n) => tools.find((t) => t.name === n)
const exec = { agent: { id: "agent-t12" }, signal: undefined }
const call = (name, args) => byName(name).execute(args, exec)

// ── C1: the seven tools exist; base resolves by functional NAME only ────────────────────────────
const names = tools.map((t) => t.name).sort()
record("C1-seven-workmate-tools", JSON.stringify(names) === JSON.stringify([
  "mpd_workmate_delete", "mpd_workmate_init", "mpd_workmate_list", "mpd_workmate_match",
  "mpd_workmate_reflect", "mpd_workmate_rename", "mpd_workmate_spawn",
]), JSON.stringify(names))

const first = await call("mpd_workmate_init", { base: "Deep Worker", note: "t12 attack" })
record("C2-auto-name-from-functional-name", first.name === "deep-worker-1" && first.baseName === "Deep Worker", JSON.stringify({ name: first.name, baseName: first.baseName }))
record("C3-init-result-carries-no-baseId", !Object.hasOwn(first, "baseId") && !JSON.stringify(first).includes("hephaestus"), JSON.stringify(first))

const second = await call("mpd_workmate_init", { base: "deep worker" })
record("C2-second-instance-increments", second.name === "deep-worker-2", second.name)
const aliasSpellings = []
for (const [index, spelling] of ["DEEP WORKER", "deep-worker", "  Deep Worker  "].entries()) {
  try {
    const r = await call("mpd_workmate_init", { base: spelling, name: "spelling-" + index })
    aliasSpellings.push([spelling, r.baseName])
  } catch (e) { aliasSpellings.push([spelling, "REFUSED: " + String(e?.message ?? e)]) }
}
record("C1-case/space/hyphen spellings resolve to the same base",
  aliasSpellings.every(([, v]) => v === "Deep Worker"), JSON.stringify(aliasSpellings))

const refusals = []
for (const id of ROLES.map((r) => r.id)) {
  try {
    const r = await call("mpd_workmate_init", { base: id, name: "id-" + id })
    refusals.push([id, "ACCEPTED as " + r.baseName])
  } catch (e) { refusals.push([id, String(e?.message ?? e)]) }
}
record("C1-every-roster-id-is-REFUSED", refusals.every(([, v]) => !v.startsWith("ACCEPTED")), JSON.stringify(refusals.map(([id]) => id)))
const anyIdInRefusal = refusals.some(([id, msg]) => msg.includes(id) || msg.includes("hephaestus"))
record("C1-refusal-message-lists-NAMES-only-no-id", !anyIdInRefusal && refusals[0][1].includes("Architect") && refusals[0][1].includes("Deep Worker"), refusals[0][1])

// ── C3: no exposed baseId across tools/schemas/descriptions/service payloads ─────────────────────
/** The distinctive roster ids: `explore` is a common English word, so the others carry the claim. */
const DISTINCTIVE_IDS = new Set(ROLES.map((r) => r.id).filter((id) => id !== "explore"))
const exposed = []
for (const t of tools) {
  const blob = JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters, schema: t.output?.schema })
  if (blob.includes("baseId")) exposed.push(t.name + ":baseId")
  if (/roster id|normal name/i.test(blob)) exposed.push(t.name + ":advertising-string")
  for (const r of roster) if (DISTINCTIVE_IDS.has(r.id) && blob.includes(r.id)) exposed.push(t.name + ":id:" + r.id)
}
record("C3-no-tool-surface-exposes-baseId-or-an-id", exposed.length === 0, JSON.stringify(exposed))

const search = `grep -rn baseId packages/mpd-workmate-plugin/src packages/mpd-bundle-plugin/src`
const grepOut = (await import("node:child_process")).execSync(search, { cwd: join(import.meta.dir, "..", "..", "..", "..", ".."), encoding: "utf8" }).trim().split("\n").filter(Boolean)
/** Internal plumbing only: the Meta type, the meta READER, the public projection + its comment,
 * the index entry type/maker, the auto-name counter and the meta.json WRITE literal. */
const INTERNAL_SITE = /index\.ts:(180|190|194|199|210|223|609|616):/
const outside = grepOut.filter((line) => !INTERNAL_SITE.test(line))
record("C3-grep-contract-command-returns-internal-plumbing-only", outside.length === 0 && !grepOut.some((l) => l.includes("mpd-bundle-plugin")),
  `roots="packages/mpd-workmate-plugin/src packages/mpd-bundle-plugin/src" pattern="baseId" hits=${grepOut.length} (all in the workmate plugin's type/reader/projection/index/write sites); outside=${JSON.stringify(outside)}`)

// ── C4: meta.json keeps baseId (provenance), and only there ─────────────────────────────────────
const metaPath = join(sandbox, ".mpd", "workmate", "deep-worker-1", "meta.json")
const meta = JSON.parse(readFileSync(metaPath, "utf8"))
record("C4-meta.json-keeps-baseId", meta.baseId === "hephaestus" && meta.baseName === "Deep Worker", JSON.stringify({ baseId: meta.baseId, baseName: meta.baseName }))

// the service the plugin registered (ctx.provide was a no-op above — re-apply with a capturing ctx)
const captured = {}
const ctx2 = { ...ctx, provide: (n, v) => { captured[n] = v }, get: ctx.get }
// tools would double-register on the same array; use a fresh array snapshot
const tools2 = []
const ctx3 = { ...ctx2, tools: { register: (d) => tools2.push(d) } }
const mod2 = await import("../../../../../packages/mpd-workmate-plugin/src/index.ts")
mod2.apply(ctx3)
const svc = captured.mpdWorkmate
const svcList = svc.list()
const svcGet = svc.get("deep-worker-1")
const svcRead = svc.read("deep-worker-1")
record("C3-service-list/get/read-strip-baseId",
  svcList.every((w) => !Object.hasOwn(w, "baseId")) && !Object.hasOwn(svcGet, "baseId") && !Object.hasOwn(svcRead, "baseId"),
  JSON.stringify({ list: svcList.length, getKeys: Object.keys(svcGet).slice(0, 6) }))

// ── C3: the web routes carry no id/baseId ───────────────────────────────────────────────────────
const callRoute = async (path, url) => {
  const handler = routes.get(path)
  let status = 0
  let body = ""
  await handler.handler({ method: "GET", url }, { writeHead: (s) => { status = s }, end: (b) => { body = b === undefined ? "" : String(b) } })
  return { status, body: body === "" ? null : JSON.parse(body) }
}
const listRoute = await callRoute("/plugins/mpd-workmate/list", "/plugins/mpd-workmate/list")
const rosterRoute = await callRoute("/plugins/mpd-workmate/roster", "/plugins/mpd-workmate/roster")
const getRoute = await callRoute("/plugins/mpd-workmate/get", "/plugins/mpd-workmate/get?name=deep-worker-1")
record("C3-list-route-has-no-baseId", listRoute.status === 200 && listRoute.body.workmates.every((w) => !Object.hasOwn(w, "baseId") && !Object.hasOwn(w, "id")), JSON.stringify(listRoute.body.workmates.map((w) => Object.keys(w))))
record("C3-roster-route-has-no-id", rosterRoute.status === 200 && rosterRoute.body.bases.every((b) => !Object.hasOwn(b, "id") && !Object.hasOwn(b, "baseId")) && rosterRoute.body.bases.length === ROLES.length,
  JSON.stringify(rosterRoute.body.bases.slice(0, 2)))
record("C3-get-route-has-no-baseId", getRoute.status === 200 && !Object.hasOwn(getRoute.body, "baseId"), JSON.stringify(Object.keys(getRoute.body)))

// ── C5 spot check: reflect / match still work and stay baseId-free ──────────────────────────────
const reflected = await call("mpd_workmate_reflect", { name: "deep-worker-1", task: "t12 review", outcome: "attacked the alias removal" })
const matched = await call("mpd_workmate_match", { task: "t12 review" })
record("C5-reflect-and-match-still-work-and-stay-clean",
  reflected.name === "deep-worker-1" && reflected.uses >= 1 && matched.matches.every((m) => !Object.hasOwn(m, "baseId")),
  JSON.stringify({ uses: reflected.uses, matches: matched.matches.length, matched: matched.matched }))

const failed = checks.filter((c) => !c.ok)
const payload = { task: "t12", driver: "t12-workmate-attack.mjs", verifiedAt: new Date().toISOString(), sandbox, checks, failed: failed.map((c) => c.id) }
;(await import("node:fs")).writeFileSync(join(import.meta.dir, "..", "t12-workmate-attack.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? " — FAILED: " + failed.map((c) => c.id).join(", ") : ""}`)
rmSync(sandbox, { recursive: true, force: true })
if (failed.length > 0) process.exit(1)
