// LANE E — the HOST→PLANE seam: does the real `GraphModels` cache, fed the same record and plan file,
// produce EXACTLY the model the two plane probes drew? The plane probes fed the model in; this arm
// closes the gap by letting the host build it from the workspace on disk.
//
// Run: bun evidence/living-graph/lane-e-verdict/<ts>/verify-host-model.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolvePlanFile } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import { GraphModels } from "../../../../packages/mpd-team-core-plugin/src/graph-model.ts"
import { readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { TEAM, PLAN, RECORD, MODEL } from "./fixture.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** A scratch workspace holding the fixture record and plan. */
const WS = mkdtempSync(join(HERE, "ws-host-"))
mkdirSync(join(WS, ".mpd", "team", "teams"), { recursive: true })
mkdirSync(join(WS, ".mpd", "plans"), { recursive: true })
writeFileSync(join(WS, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(RECORD, null, 1))
writeFileSync(join(WS, ".mpd", "plans", "task-plan.md"), PLAN)

/** Diagnostics the cache emitted. */
const warnings: string[] = []
/** The cache under test: the same one the production row mounts, with a fixed revision and no feed. */
const models = new GraphModels({
  revision: (): number => 0,
  notify: (): void => {},
  warn: (warning: string): void => { warnings.push(warning) },
})

/** The model the host builds for the fixture team. */
let hostModel: GraphModel | undefined
/** The plan path the host resolved. */
const resolved = resolvePlanFile(WS)
try {
  hostModel = models.get(WS, readTeam(WS, TEAM) as Parameters<typeof models.get>[1])
} finally {
  models.dispose()
}

/** The model the plane probes consumed, for a field-by-field comparison. */
const comparable = (model: GraphModel | undefined): unknown => model === undefined ? null : JSON.parse(JSON.stringify(model))
/** The observed ids and ranks. */
const ranks = hostModel === undefined ? [] : hostModel.nodes.map((node) => [node.id, node.depth])
/** The observed edges. */
const edges = hostModel === undefined ? [] : hostModel.edges.map((edge) => `${edge.from}->${edge.to}:${edge.source}`)
/** The observed report. */
const report = hostModel === undefined ? null : { planOnly: hostModel.report.planOnly, edgePlanOnly: hostModel.report.edgePlanOnly, ranksDerived: hostModel.report.ranksDerived }

/** The measured result. */
const result = {
  probe: "host-model",
  at: new Date().toISOString(),
  workspace: WS,
  resolvedPlan: resolved,
  warnings,
  observed: { ranks, edges, report, nodeCount: hostModel?.nodes.length ?? 0 },
  verdict: {
    // The host resolved the fixture plan (the only .md in this scratch workspace).
    resolvedTheFixturePlan: resolved === join(WS, ".mpd", "plans", "task-plan.md"),
    // The host's projection reproduces the SAME model the plane probes drew, byte for byte.
    hostModelEqualsTheServedFixture: JSON.stringify(comparable(hostModel)) === JSON.stringify(comparable(MODEL)),
    // The discriminating facts, stated as their own observations.
    ghostPresent: hostModel?.nodes.some((node) => node.id === "T5" && node.planned === true) === true,
    planOnlyEdgePresent: edges.includes("T1->T2:plan"),
    agreeingEdgePresent: edges.includes("T2->T4:both"),
    ranksAreTheDerivedOnes: JSON.stringify(ranks) === JSON.stringify([["T1", 0], ["T2", 1], ["T3", 1], ["T4", 2], ["T5", 3]]),
  },
}
writeFileSync(join(HERE, "host-model-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
