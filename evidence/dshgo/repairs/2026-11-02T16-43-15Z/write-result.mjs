// THE T8 REPAIR RESULT: the four findings, what each fix does, and what the gates observed.
//
// Every claim here is one the files and the gate log in this directory actually show. Findings that are
// NOT in this task's scope (M1) are recorded as still-open rather than silently absorbed.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote after the repair. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The repair result this directory certifies. */
const result = {
  lane: "T8 — Repair: dead complete/fail control, watchdog workspace, memory.dir override, memory merge order",
  at: new Date().toISOString(),
  findingsAddressed: [
    {
      id: "H1",
      title: "the Detail tab's complete/fail taps could never succeed (anonymous panel tap vs owner-only tool)",
      fix: "REMOVED the control, not the rule. `createTeamPanelActions` no longer publishes `complete`/`fail`, the Detail tab no longer renders them, and a `callout` says settling belongs to the owning member. `agent_teams_task` keeps its owner-only gate untouched (the finding's 'do NOT widen owner-only' direction).",
      where: "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts (action map), src/dshgo-views.ts detailTab, src/dshgo-copy.ts settleHint",
      whyThisShape: "a tap carries no agent, so every alternative either widened the gate or faked an identity; hiding a dead control is the honest repair the verifier's own direction lists first"
    },
    {
      id: "M3",
      title: "hold/resume could land in a workspace root that is not the panel's session root",
      fix: "REMOVED the taps and made the Watchdog tab read-only, with copy naming where the action lives. The panel no longer routes a MUTATION through a tool whose exec has no session (`session-watchdog-hold`/`-resume` resolve their root from DSH_WORKSPACE_ROOT → cwd).",
      where: "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts, src/dshgo-views.ts watchdogTab, src/dshgo-copy.ts watchdogReadOnly",
      whyThisShape: "the two sanctioned alternatives (hold/resume on the `mpdWatchdog` service, or a workspace-bound exec) live in the watchdog package and the adapter's `executeTool`, both outside this repair's write scope; leaving a tap that can write to the wrong store was not acceptable"
    },
    {
      id: "M2",
      title: "the Memory tab ignored `memory.dir` and read the wrong store",
      fix: "`readMemoryStore(workspace, now, scope)` now resolves `<workspace>/<memory.dir or \".mpd\">/memory/agents/<slug>/…`, and `registerDshGoPanel` receives the scope from the mounted `mpdConfig` (`memory.dir`, `memory.agentSlug`) through `index.ts`. The GLOBAL store stays out of the tab by declaration: the caption says it reads THIS agent's workspace entries.",
      where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts (PanelMemoryScope, memorySlugOf, readMemoryStore, PanelOptions.memory), src/index.ts (memoryScopeOf), src/dshgo-copy.ts (memoryCaption)",
      test: "test/dshgo-panels-v2.test.ts — `memory.dir` moves the store; the default `.mpd` is then ignored"
    },
    {
      id: "N1",
      title: "the Memory tab merged every agent slug, so another agent's entries could show",
      fix: "the reader now walks ONE slug — the memory row's own rule, mirrored in `memorySlugOf` (explicit `memory.agentSlug`, else `agent-<workspace name>`) — and the caption states the ordering (newest by write time) so it cannot be mistaken for the tool's filename order.",
      where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts memorySlugOf / readMemoryStore",
      test: "test/dshgo-panels-v2.test.ts — a sibling agent's entry never leaks in; an explicit agentSlug selects that agent"
    },
    {
      id: "N2",
      title: "legacy reflection.json keys showed 0/0",
      fix: "the reader now falls back to `reflected_completed_steps` / `steps_since_last_successful_reflection`, mirroring the memory row's own compatibility bound; the current names still win.",
      where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts readMemoryStore",
      test: "test/dshgo-panels-v2.test.ts — legacy keys are read; current names take precedence"
    }
  ],
  stillOpen: [
    {
      id: "M1",
      title: "§7.2 rule 6's task clause (badge for kind/status, timeline for a task's life)",
      why: "not named by this repair task; it needs a contract restatement (a `list` row cannot carry a badge) or a design change in the team panel. Reported to the Lead so it is routed rather than dropped."
    }
  ],
  measured,
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "665 pass, 0 fail (37 files)" },
    { id: "bun run typecheck", exit: 0, observed: "tsgo --noEmit, no diagnostics" },
    { id: "bun run verify:comments", exit: 0, observed: "VERDICT: PASS" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=54 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS — manifest + static views are legal" },
    { id: "app checker (declared views + all four live trees)", exit: 0, observed: "six runs, every one exit 0 — checker.log" }
  ],
  docsUpdated: [
    "docs/drive-surface.md + docs/drive-surface.zh-CN.md — the tap list no longer claims complete/fail/hold/resume, and explains WHY the team panel mutates nothing",
    "docs/user-guide.md + docs/user-guide.zh-CN.md — §16.2 now tells the user the panel never changes a task state or a team pause, and where those actions live"
  ],
  bounds: [
    "The rendered look stays UNPROVEN (no Flutter app in this workspace).",
    "`hold`/`resume` are GONE from the native panel in this wave; restoring them needs either a watchdog-service member or a workspace-bound exec — both outside this task's write scope.",
    "`complete`/`fail` are GONE from the native panel for the same reason; a future human channel for the team tools would be the way back, and it is a contract decision.",
    "The Memory tab is WORKSPACE-ONLY by declaration: the global store (`$HOME/.mpd/memory`) is not read, and the caption says so."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
