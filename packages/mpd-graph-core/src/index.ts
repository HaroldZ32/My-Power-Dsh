// THE PUBLIC SURFACE OF THE SHARED PLAN→GRAPH CORE.
//
// TWO WAYS IN, ON PURPOSE. A HOST consumer imports this barrel: it gets the parser, the merge, the
// file resolution and the watcher, which are the four things that need `node:fs`. A consumer whose
// bundle must stay browser-safe (a client-side renderer) imports the module it needs directly —
// `./rank.ts` for the derivation, `./types.ts` for the shapes — so a browser build never pulls a
// Node built-in in through a barrel it did not need. Both paths are the same implementation; there
// is no client copy.
export type {
  BoardTask,
  BuildModelInput,
  GraphEdge,
  GraphModel,
  GraphNode,
  GraphReport,
  GraphTask,
  PlanDocument,
  PlanLane,
  PlanProblem,
  PlanSection,
  PlanTask,
  RankPlan,
  RankTask,
} from "./types.ts"
export { ID_ORDER, bucketRanks, cycleIds, deriveRanks, rankPlan, servedRank } from "./rank.ts"
export { parsePlanMarkdown } from "./plan.ts"
export { buildModel } from "./model.ts"
export { readPlanFile, resolvePlanFile } from "./resolve.ts"
export type { GraphChangeEvent, GraphWatchOptions, GraphWatchTargets, GraphWatcher } from "./watch.ts"
export { watchGraph } from "./watch.ts"
