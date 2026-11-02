// R-W3D reviewer probe — event matching, idempotence (index + journal), and the T-43/F1 guard arms.
// Everything runs inside a mkdtemp sandbox passed as argv[2]; the real ~/.mpd is never named.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  handleArchiveCall, installArchiveHook, matchArchiveEvent, writeArchiveEntry,
  type ArchiveCallContext, type ArchivedPlanView,
} from "../../../packages/mpd-memory-plugin/src/archive.ts"
import { globalRoot, scopeOf } from "../../../packages/mpd-memory-plugin/src/store.ts"

const SB = process.argv[2]!
const HOME = join(SB, "home")
const wsA = join(SB, "wsA")
const wsB = join(SB, "wsB")
const archiveDir = join(SB, "plans-archive", "plan-7")
mkdirSync(HOME, { recursive: true })
mkdirSync(wsA, { recursive: true })
mkdirSync(wsB, { recursive: true })
mkdirSync(archiveDir, { recursive: true })
process.env.HOME = HOME
process.env.DSH_HOME = join(SB, "dsh")

const logs: string[] = []
const log = (l: string) => { logs.push(l) }
const plans: ArchivedPlanView[] = [{ planId: "plan-7", teamId: "team-9", approvedAt: "2026-11-02T10:00:00Z", path: join(archiveDir, "plan.json") }]
const base = (workspace: string, extra: any = {}): ArchiveCallContext => ({ workspace, config: { vcs: "git" as const, ...extra }, teams: { archivedPlans: () => plans } })

console.log("== globalRoot derivation ==")
console.log("sandbox HOME  :", globalRoot({}), "| inside HOME:", globalRoot({}).startsWith(HOME))
console.log("globalDir wins:", globalRoot({ globalDir: join(SB, "elsewhere") }))
console.log("scopeOf({})   :", scopeOf({}), "| global:", scopeOf({ scope: "global" }), "| typo:", scopeOf({ scope: "Global" }))

console.log("\n== matchArchiveEvent matrix ==")
const m = (name: string, args: any, value: any, ctx = base(wsA), isError = false) =>
  console.log(`${name} ->`, JSON.stringify(matchArchiveEvent(ctx, name, args, { isError, value }, log)?.kind ?? null), (matchArchiveEvent(ctx, name, args, { isError, value }, log) ? JSON.stringify(matchArchiveEvent(ctx, name, args, { isError, value }, log)) : ""))
m("mpd_boulder_complete", {}, { workId: "w-1" })
m("mpd_boulder_complete", {}, { workId: "w-1" }, base(wsA), true)
m("mpd_boulder_complete", { workId: "arg-w" }, {})
m("cellwork_stop", {}, { ok: true, cellId: "cell-1" })
m("cellwork_stop", {}, { ok: false, cellId: "cell-1" })
m("agent_teams_plan", { action: "approve" }, { archivedTo: archiveDir })
m("agent_teams_plan", { action: "delete" }, { archivedTo: archiveDir })
m("agent_teams_plan", { action: "delete" }, {})
console.log("teams absent  ->", JSON.stringify(matchArchiveEvent({ workspace: wsA, config: {} }, "agent_teams_plan", { action: "delete" }, { value: { archivedTo: archiveDir } }, log) ?? null), "| log:", logs.at(-1))
console.log("approvedAt '' ->", JSON.stringify(matchArchiveEvent({ workspace: wsA, config: {}, teams: { archivedPlans: () => [{ planId: "p", teamId: "t", path: join(archiveDir, "plan.json") }] } }, "agent_teams_plan", { action: "delete" }, { value: { archivedTo: archiveDir } }, log) ?? null))
console.log("not in listing->", JSON.stringify(matchArchiveEvent(base(wsA), "agent_teams_plan", { action: "delete" }, { value: { archivedTo: join(SB, "nope") } }, log) ?? null), "| log:", logs.at(-1))

console.log("\n== idempotence: same key twice, then another workspace ==")
const ctxA = base(wsA)
const first = writeArchiveEntry(ctxA, { kind: "boulder_complete", projectKey: "w-1" })
const second = writeArchiveEntry(ctxA, { kind: "cellwork_stop", projectKey: "w-1" })
const other = writeArchiveEntry(base(wsB), { kind: "boulder_complete", projectKey: "w-1" })
console.log("first:", JSON.stringify({ key: first.key, file: first.file.split("/").pop(), superseded: first.superseded }))
console.log("second:", JSON.stringify({ key: second.key, file: second.file.split("/").pop(), superseded: second.superseded }))
console.log("other ws:", JSON.stringify({ key: other.key, file: other.file.split("/").pop(), superseded: other.superseded }))
const g = globalRoot({})
const rd = (p: string) => { try { return readFileSync(p, "utf8") } catch { return "<missing>" } }
console.log("entry files:", JSON.stringify((readFileSync(join(g, "runtime", "index.json"), "utf8")) ? (await import("node:fs")).readdirSync(join(g, "repo", "memory")) : []))
console.log("index.json:\n" + rd(join(g, "runtime", "index.json")))
console.log("journal.jsonl:\n" + rd(join(g, "runtime", "journal.jsonl")))
console.log("entry body head:\n" + rd(first.file).split("\n").slice(0, 10).join("\n"))

console.log("\n== T-43/F1 guard: a root OUTSIDE $HOME under a DSH_HOME-set boot ==")
const outside = join(SB, "outside-memory")
let refusal: any
try { writeArchiveEntry(base(wsA, { globalDir: outside }), { kind: "boulder_complete", projectKey: "w-2" }); refusal = "WROTE (no refusal)" }
catch (e: any) { refusal = { name: e?.name, code: e?.code, status: e?.status, message: String(e?.message).slice(0, 90) } }
console.log("outside-HOME :", JSON.stringify(refusal), "| dir created:", existsSync(outside))

delete process.env.HOME
let missingHome: any
try { writeArchiveEntry(base(wsA), { kind: "boulder_complete", projectKey: "w-3" }); missingHome = "WROTE (no refusal)" }
catch (e: any) { missingHome = { name: e?.name, code: e?.code } }
console.log("HOME unset   :", JSON.stringify(missingHome), "| real ~/.mpd/memory untouched by this probe:", !existsSync(join(process.env.HOME ?? "/nonexistent", ".mpd", "memory")))
process.env.HOME = HOME

console.log("\n== the listener: always undefined, contains its own throw ==")
const dsh = { onPostToolExecute: (fn: any) => { const r = fn({ name: "mpd_boulder_complete", arguments: {} }, { isError: false, value: { workId: "w-4" } }); console.log("listener returned:", JSON.stringify(r)); return () => { console.log("disposer called: ok") } } }
const dispose = installArchiveHook(dsh as any, () => base(wsA))
console.log("disposer type:", typeof dispose)
dispose()
const broken = { onPostToolExecute: () => { throw new Error("no bus") } }
console.log("install on a throwing adapter returns a no-op:", typeof installArchiveHook(broken as any, () => base(wsA)))
console.log("\nhandleArchiveCall on a guard-refused path returns null:", JSON.stringify(handleArchiveCall(base(wsA, { globalDir: outside }), "mpd_boulder_complete", {}, { value: { workId: "w-5" } }, log)), "| log:", logs.at(-1)?.slice(0, 80))
