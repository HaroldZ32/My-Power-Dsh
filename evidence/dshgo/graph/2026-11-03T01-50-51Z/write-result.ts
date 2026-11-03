// T20 — THE LAYERED DEPENDENCY GRAPH: mono codeBlock inside a v2 collapsible, steps below 1.0.9.
//
// The shapes are the APP'S (read in lib/ui/chat/dsh_ui/dsh_ui_plugin_controls_model.dart):
// `collapsible` reads `label` + `children`, `codeBlock` reads `code` (+ optional `language`) and is capped
// at 8000 characters. Both names are v2-only, which is why an older app gets `steps` instead — adaptView
// would otherwise flatten the block into one text paragraph.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The result this directory certifies. */
const result = {
  lane: "T20 — Native DAG: layered dependency graph as a mono codeBlock (collapsible) + steps fallback",
  at: new Date().toISOString(),
  what: {
    layout: "a task's level is the longest blocker chain above it (relaxation, capped at the task count so a CYCLIC board still renders); every line is `L<n> <id> <subject> <-<blockers>`",
    v2: "a v2 `collapsible` (label = the section heading) wrapping a `codeBlock` of those lines — the fold keeps the graph from eating the phone's fold",
    v1: "one `steps` entry per layer, because `codeBlock` and `collapsible` are v2-only; the same layering, no fold",
    where: "packages/mpd-bundle-plugin/src/dshgo-graph.ts (NEW, pure) + src/dshgo-views.ts boardTab (hand-rolled `fold`/`codeBlock` nodes, documented as the two v2 components the kit does not wrap)"
  },
  measured,
  delta: { teamV2: "3452 B / 39 nodes / depth 4 (before the graph) -> 3792 B / 44 nodes / depth 5", teamV1: "2299 / 33 / 4 -> 2458 / 36 / 4", mpd: "unchanged (3313 / 41 / 5)" },
  tests: [
    "levels follow the longest blocker chain; an unknown blocker id is ignored (the same rule the ready list uses)",
    "a CYCLIC board lays out instead of hanging",
    "the code block prints `L0 T1 Build it` / `L1 T2 Prove it <-T1`",
    "the panel emits exactly ONE fold with a codeBlock on v2, and `steps` with NO codeBlock/collapsible on v1"
  ],
  docDebtClosed: [
    "docs/user-guide.md had REGRESSED to the four-tab text (a concurrent writer replaced it after T18); re-applied together with the graph sentence",
    "packages/mpd-bundle-plugin/README.md + README.zh-CN.md still described the workbench panel as FOUR tabs; both now say three",
    "drive-surface (en+zh) and user-guide (en+zh) describe the graph and both v2/v1 shapes"
  ],
  checkerNote: "the checker flagged `未知 tone \"muted\"` on the two v2 callouts (the app accepts only info/good/warn/bad); both callouts now carry NO tone, and the note is gone",
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "679 pass, 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "0 errors" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "PASS (one untyped default parameter in the new test helper — fixed)" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=55 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 fresh (the bundle target rebuilt)" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" },
    { id: "app checker", exit: 0, observed: "both static views + all four live trees exit 0" }
  ],
  bounds: [
    "NO RENDER: no Flutter SDK / CJK test fonts in this session, so the graph's appearance is proven by the app's parser contract (field names + the 8000-character cap) and by the tree assertions, not by a PNG.",
    "The graph is TEXT, not geometry: no boxes, no diagonal edges, 18 characters of subject and 20 lines before `+N more`. A phone-width code block is ~40 characters; box art would wrap or need horizontal scrolling.",
    "The v1 `steps` fallback shows one step per LAYER with the ids as detail — it conveys the blocking order, not the individual edges, because `steps` has no per-line text."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
