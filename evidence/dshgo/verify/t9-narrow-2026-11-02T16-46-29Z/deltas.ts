// T9 BEHAVIOURAL DELTAS: the repaired surfaces, measured rather than inferred from the diff.
//
//   1. the PUBLISHED action table of the team panel (not just the tree) has no complete/fail/hold/resume;
//   2. readMemoryStore honours a REAL `memory.dir` and a REAL `agentSlug`, reads ONE agent only, and
//      tolerates the legacy reflection.json key names;
//   3. the v1 fallback still carries the meaning (no v2 component, no style/accent).
//
// Runs under bun (the bundle sources use extensionless specifiers). Writes one JSON verdict beside itself.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTeamPanelActions } from "../../../../packages/mpd-bundle-plugin/src/dshgo-team-panel.ts"
import { readMemoryStore, memorySlugOf } from "../../../../packages/mpd-bundle-plugin/src/dshgo-panel.ts"

/** The verdicts this script records. */
const out: Record<string, unknown> = { at: new Date().toISOString() }
/** Any failed assertion, collected so the report shows all of them at once. */
const failures: string[] = []
/** Records one assertion. */
function check(name: string, ok: boolean, detail: unknown): void {
  out[name] = { ok, detail }
  if (!ok) failures.push(name)
}

// ── 1. the PUBLISHED action table ────────────────────────────────────────────
const table = createTeamPanelActions(
  { dsh: {}, ctx: { get: () => undefined }, log: () => {} } as never,
  { set: () => {}, get: () => "" } as never,
)
const keys = Object.keys(table).sort()
check("actionTable.keys", JSON.stringify(keys) === JSON.stringify(["back", "refresh", "select"]), keys)
const banned = ["complete", "fail", "hold", "resume"].filter((name) => name in table)
check("actionTable.bannedAbsent", banned.length === 0, banned)

// ── 2. the memory reader's scope behaviour ───────────────────────────────────
const root = mkdtempSync(join(tmpdir(), "mpd-t9-mem-"))
/** The workspace whose basename derives the default agent slug. */
const ws = join(root, "demo-ws")
/** Writes one entry with the JSON frontmatter the store really writes. */
function entry(stateDir: string, slug: string, file: string, description: string, kind: string, mtimeSec: number): void {
  const dir = join(ws, stateDir, "memory", "agents", slug, "repo", "memory")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, `---\n${JSON.stringify({ description, kind })}\n---\nbody of ${file}\n`)
  utimesSync(path, mtimeSec, mtimeSec)
}
const nowSec = Math.floor(Date.now() / 1000)
const defaultSlug = memorySlugOf(ws)
check("defaultSlug", defaultSlug === "agent-demo-ws", defaultSlug)
entry(".mpd", defaultSlug, "a-older.md", "default older", "note", nowSec - 500)
entry(".mpd", defaultSlug, "b-newer.md", "default newer", "fact", nowSec - 100)
entry(".mpd", "agent-other", "c-sibling.md", "sibling agent", "note", nowSec - 50)
entry(".memory-alt", defaultSlug, "d-override.md", "override dir", "note", nowSec - 200)
mkdirSync(join(ws, ".mpd", "memory", "agents", defaultSlug, "runtime"), { recursive: true })
writeFileSync(join(ws, ".mpd", "memory", "agents", defaultSlug, "runtime", "reflection.json"),
  JSON.stringify({ reflected_completed_steps: 2, steps_since_last_successful_reflection: 5 }))

const dflt = readMemoryStore(ws, Date.now())
check("default.seesDefaultStore", dflt !== null && dflt.entries.some((e) => e.description === "default newer"), dflt?.entries)
check("default.newestFirst", dflt !== null && dflt.entries[0]?.description === "default newer", dflt?.entries.map((e) => e.description))
check("default.excludesOverrideDir", dflt !== null && !dflt.entries.some((e) => e.description === "override dir"), dflt?.entries.map((e) => e.description))
check("default.excludesSiblingAgent", dflt !== null && !dflt.entries.some((e) => e.description === "sibling agent"), dflt?.entries.map((e) => e.description))
check("default.legacyReflectionKeys", dflt !== null && dflt.reflections === 2 && dflt.steps === 5, { reflections: dflt?.reflections, steps: dflt?.steps })
const overridden = readMemoryStore(ws, Date.now(), { dir: ".memory-alt" })
check("override.dirHonoured", overridden !== null && overridden.entries.length === 1 && overridden.entries[0]?.description === "override dir", overridden?.entries)
const sibling = readMemoryStore(ws, Date.now(), { agentSlug: "agent-other" })
check("override.agentSlugHonoured", sibling !== null && sibling.entries.length === 1 && sibling.entries[0]?.description === "sibling agent", sibling?.entries)
check("absentStoreIsNull", readMemoryStore(join(root, "no-ws"), Date.now()) === null, null)

// ── the verdict ──────────────────────────────────────────────────────────────
out["failures"] = failures
out["ok"] = failures.length === 0
writeFileSync(join(import.meta.dir, "deltas.json"), `${JSON.stringify(out, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ ok: out["ok"], failures, actionTableKeys: keys, memory: { entries: dflt?.entries.map((e) => e.description), reflections: dflt?.reflections, steps: dflt?.steps } }, null, 1)}\n`)
if (failures.length > 0) throw new Error("T9 deltas failed: " + failures.join(", "))
