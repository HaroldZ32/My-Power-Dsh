// L6 evidence (web-follow): renders `TeamView` against a LIVE payload and an ENDED payload using the
// SAME hook runtime and type-strip the package's own tests use, and prints the VISIBLE text of each.
// This is the durable artifact behind `result.json`'s "observed render" claims; it asserts nothing and
// writes nothing outside stdout, so the package's tests remain the gate and this file is the witness.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"
import { createHookRuntime } from "../../../../packages/mpd-bundle-plugin/test/client-harness.ts"

/** The repo root, derived from this file's own URL (`<root>/evidence/tui/panel-wave/l6-web-follow`). */
const ROOT = join(import.meta.dirname, "..", "..", "..", "..")
/** The factory source under test. */
const SOURCE = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-view.ts"), "utf8")

/**
 * The view module this evidence drives, evaluated exactly the way the test harness evaluates it: the
 * factory is one arrow expression with its types erased, never an import.
 * @param react - the SAME hook runtime the render runs in, or the effect never publishes its state.
 * @returns the module the build's own splice would produce.
 */
function loadView(react: unknown): { TeamView: (props?: unknown) => unknown } {
  /** The source with every type annotation erased by the same tool class the build uses. */
  const stripped = ts.transpileModule(SOURCE, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  /** The evaluated arrow expression. */
  const factory = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as (deps: unknown) => { createTeamView: (deps: unknown) => { TeamView: (props?: unknown) => unknown } }
  return factory({}).createTeamView({ react, statePath: "/plugins/mpd-team/state", planPath: "/plugins/mpd-team/plan", taskPath: "/plugins/mpd-team/task", pollMs: 60_000 })
}

/**
 * Flatten a rendered element tree into the text a reader sees.
 * @param value - one node of the tree.
 * @returns the concatenated text content.
 */
function flatText(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(flatText).join(" ")
  if (typeof value === "object" && "props" in (value as Record<string, unknown>)) {
    // The scoped stylesheet is not visible text; skipping it keeps the snapshot to what a reader sees.
    if ((value as { type?: unknown }).type === "style") return ""
    return flatText((value as { props?: { children?: unknown } }).props?.children)
  }
  return ""
}

/**
 * The visible panel text for one payload, fetched through the same routes the view polls.
 * @param state - the team-state payload to serve.
 * @returns the flattened panel text.
 */
async function renderText(state: unknown): Promise<string> {
  /** The hook runtime this render runs in. */
  const hooks = createHookRuntime()
  /** The only transport the view reaches: its three JSON routes. */
  globalThis.fetch = (async (url: unknown): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    /** The path half of the requested URL. */
    const path = String(url).split("?")[0]
    if (path === "/plugins/mpd-team/state") return { ok: true, status: 200, json: async () => state }
    if (path === "/plugins/mpd-team/plan") return { ok: true, status: 200, json: async () => ({ ok: true, plan: null }) }
    if (path === "/plugins/mpd-team/task") return { ok: true, status: 200, json: async () => ({ ok: true, contracts: [], hold: null }) }
    return { ok: false, status: 404, json: async () => null }
  }) as unknown as typeof fetch
  /** The component's settled tree. */
  const tree = await hooks.render(loadView(hooks.react).TeamView, { sessionId: "s1" } as never)
  return flatText(tree).replace(/\s+/g, " ").trim()
}

/** The ending instant this snapshot's ended payload carries: three minutes before this run. */
const ENDED_AT = new Date(Date.now() - 3 * 60_000 - 500).toISOString()

/** The board + roster both payloads share, so the only difference is the ended treatment. */
const MEMBERS = [{ id: "m1", name: "web-team-gui", role: "Senior Engineer", status: "running", done: 1, total: 2, current: "Build the header", route: "deepseek/deepseek-chat" }]
/** The counts both payloads share. */
const COUNTS = { total: 4, completed: 1, running: 1, ready: 1, blocked: 1, failed: 0, releasedByFailure: 0 }

/** The LIVE payload: an active team with a running member. */
const LIVE = {
  ok: true,
  workspace: "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh",
  team: { id: "team-alpha", name: "Wave GUI", description: "d", phase: "active", approvedAt: "2026-10-05T10:00:00.000Z", links: 0 },
  counts: COUNTS,
  members: MEMBERS,
  tasks: [],
  cycles: [],
  executor: { kind: "native", reason: "x" },
  problems: [],
}

/** The ENDED payload: the same roster, the head's derived `ended` phase, the instant on the listing. */
const ENDED = {
  ok: true,
  workspace: "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh",
  team: { id: "team-alpha", name: "Wave GUI", description: "d", phase: "ended", approvedAt: "2026-10-05T10:00:00.000Z", links: 0 },
  workspaceTeams: { records: [{ id: "team-alpha", name: "Wave GUI", description: "d", phase: "ended", endedAt: ENDED_AT, tasks: { total: 4, completed: 1, failed: 0 }, members: 2, active: true }], activeId: "team-alpha" },
  counts: COUNTS,
  members: MEMBERS,
  tasks: [],
  cycles: [],
  executor: { kind: "native", reason: "x" },
  problems: [],
}

console.log("=== LIVE PAYLOAD (renders as before) ===")
console.log(await renderText(LIVE))
console.log("")
console.log("=== ENDED PAYLOAD (endedAt=" + ENDED_AT + ") ===")
console.log(await renderText(ENDED))

// The view's poller owns a live interval; this witness is done once both shapes are printed.
process.exit(0)
