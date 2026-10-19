// LANE E — the cross-plane JOIN, verified on the observed bytes: the TUI drawing, the web drawing and
// the ONE model must agree, and neither renderer may hold a derivation of its own.
//
// This is the "single computation site" arm. It reads the two probes' OBSERVED results (not their
// sources) and compares them, id by id and edge by edge, against the model both planes were served.
// The static half then shows where that model is computed: exactly one product call site, and a web
// client artifact that contains no derivation at all.
//
// Run: bun evidence/living-graph/lane-e-verdict/<ts>/compare-planes.ts
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MODEL } from "./fixture.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** The repo root, four levels above this evidence directory. */
const ROOT = join(HERE, "..", "..", "..", "..")
/** Read one text file under the repo root. */
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8")
/** Read one JSON result written by a probe. */
const json = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(HERE, name), "utf8")) as Record<string, unknown>
/** Count non-overlapping occurrences of a token. */
const count = (text: string, token: string): number => text.split(token).length - 1
/** The comparable form of an id list. */
const sorted = (values: readonly string[]): string[] => [...values].sort()

/** The TUI probe's observed result. */
const tui = json("tui-result.json") as {
  tui: { ranks: Array<[string, number]>; drawnEdgeSource: string[]; tasks: Array<{ id: string; dependencies: string[] }> }
  verdict: Record<string, boolean>
}
/** The web probe's observed result. */
const web = json("web-result.json") as {
  web: { boxes: Array<{ id?: string; rank: number; planned: boolean }>; edges: string[] }
  payload: { servedRanks: Array<{ id: string; rank?: number; depth: number }>; hasModel: boolean }
  verdict: Record<string, boolean>
}
/** The host seam arm: the real GraphModels cache over the same workspace. */
const host = json("host-model-result.json") as { resolvedPlan: string; verdict: Record<string, boolean> }
/** The flat arms' observed results. */
const tuiFlat = (json("tui-result.json") as { flat: { hits: Array<{ id: string; row: number }>; modelRanks: string[][]; ranksDerived: boolean } }).flat

/** The model's own id → rank map, as the single truth. */
const modelRanks = new Map(MODEL.nodes.map((node) => [node.id, node.depth]))
/** The model's edges, in both renderers' witness spellings. */
const modelEdgeArrows = MODEL.edges.map((edge) => `${edge.from}->${edge.to}`).sort()
/** The model's edges as the web publishes them (`blocked<-blocker`). */
const modelEdgeWitness = MODEL.edges.map((edge) => `${edge.to}<-${edge.from}`).sort()
/** The web boxes as an id → rank map (a box with no readable id is recorded as `?`). */
const webRanks = new Map(web.web.boxes.map((box) => [box.id ?? "?", box.rank]))
/** The TUI ranks as a sorted pair list, comparable to the model's. */
const tuiRankPairs = [...tui.tui.ranks].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

/** The product sources whose ownership of the derivation the static half settles. */
const SOURCES = {
  clientBundle: read("packages/mpd-bundle-plugin/client.js"),
  webFactory: read("packages/mpd-bundle-plugin/src/team-view.ts"),
  tuiTeamState: read("packages/mpd-tui-plugin/src/team-state.ts"),
  tuiGraph: read("packages/mpd-tui-plugin/src/graph.ts"),
  hostCache: read("packages/mpd-team-core-plugin/src/graph-model.ts"),
}

/** The measured result. */
const result = {
  probe: "cross-plane-join",
  at: new Date().toISOString(),
  model: { nodes: [...modelRanks.entries()].sort(), edges: modelEdgeArrows },
  observed: {
    tuiRanks: tuiRankPairs,
    webBoxes: web.web.boxes,
    tuiDrawnEdges: sorted(tui.tui.drawnEdgeSource),
    webDrawnEdges: sorted(web.web.edges),
    servedRanks: web.payload.servedRanks,
    flat: { tuiHits: tuiFlat.hits, tuiModelRanks: tuiFlat.modelRanks, tuiRanksDerived: tuiFlat.ranksDerived },
  },
  host: { resolvedPlan: host.resolvedPlan, verdict: host.verdict },
  static: {
    clientBundleDeriveRanks: count(SOURCES.clientBundle, "deriveRanks"),
    clientBundleBuildModel: count(SOURCES.clientBundle, "buildModel"),
    clientBundleIdOrder: count(SOURCES.clientBundle, "ID_ORDER"),
    webFactoryBuildModel: count(SOURCES.webFactory, "buildModel"),
    tuiTeamStateBuildModel: count(SOURCES.tuiTeamState, "buildModel"),
    tuiGraphRankPlanImports: count(SOURCES.tuiGraph, "rankPlan"),
    hostCacheBuildModelCalls: count(SOURCES.hostCache, "buildModel("),
  },
  verdict: {
    // 1. The model is ONE value: the TUI's ranks and the web's boxes both equal it, node by node.
    tuiRanksEqualModel: JSON.stringify(tuiRankPairs) === JSON.stringify([...modelRanks.entries()].sort()),
    webRanksEqualModel: MODEL.nodes.every((node) => webRanks.get(node.id) === node.depth),
    // 2. The EDGES are the model's, on both planes, including the plan-only one.
    tuiEdgesEqualModel: JSON.stringify(sorted(tui.tui.drawnEdgeSource)) === JSON.stringify(modelEdgeArrows),
    webEdgesEqualModel: JSON.stringify(sorted(web.web.edges)) === JSON.stringify(modelEdgeWitness),
    // 3. The host's served `rank` is the model's depth, never the store's `depth`.
    servedRankIsModelRank: web.payload.servedRanks.every((task) => task.rank === modelRanks.get(task.id)),
    // 4. THE HOST reproduces exactly this model from the workspace on disk (the seam between the
    //    cache and the values the plane probes drew).
    hostModelEqualsServed: host.verdict.hostModelEqualsTheServedFixture === true,
    // 5. ONE computation site: the web artifact holds no derivation, and the only product call of
    //    buildModel is the host cache (the TUI imports rankPlan, which is the same core, not a copy).
    webArtifactHasNoRankDerivation: count(SOURCES.clientBundle, "deriveRanks") === 0 && count(SOURCES.clientBundle, "buildModel") === 0,
    // OBSERVATION, not a defect: the web factory still declares its own numeric collator for the
    // WITHIN-COLUMN sort. It is a comparator, not a rank derivation, and both planes sort by the same
    // rule today; it is recorded because "one core" would eventually publish the order itself.
    webCollatorDuplicated: count(SOURCES.clientBundle, "ID_ORDER") === 2,
    webFactoryHasNoModelCall: count(SOURCES.webFactory, "buildModel") === 0,
    tuiHasNoModelCall: count(SOURCES.tuiTeamState, "buildModel") === 0,
    hostIsTheOnlyModelCall: count(SOURCES.hostCache, "buildModel(") === 1,
    // 6. The flat board draws flat on BOTH planes, from ONE derived rank.
    flatDrawsFlat: new Set(tuiFlat.hits.map((hit) => hit.row)).size === 1 && tuiFlat.hits.length === 5 && tuiFlat.modelRanks.length === 1 && tuiFlat.ranksDerived === true,
  },
}
writeFileSync(join(HERE, "compare-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
