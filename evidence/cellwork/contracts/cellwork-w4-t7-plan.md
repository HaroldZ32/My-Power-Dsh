# W4-T7 — web nested-DAG patch plan (handed over by team-engineer, 2026-10-26T11:55Z)

Goal: D4 of `.mpd/plans/cellwork-w4-contract.md` — a subcell renders as a `.mpd-dag-group` frame whose
interior is its own DAG; external edges attach to the frame; recursion repeats; the BUILT `client.js`
carries it.

Scope: `packages/mpd-bundle-plugin/**` only. NO git writes. If one full pass cannot reach a green
freeze, `git checkout -- packages/mpd-bundle-plugin` and hand back the NARROW seam (types + frame
channel + DOM layer + extended instrument + rebuilt client) — never leave a partial lane.

## Anchors (verified in the current file)

- `layout` body 1639→2310: `withGhosts` (ghosts from `served.nodes`, `planned===true` only) →
  `rankOfTask` → columns → 2× barycenter rounds → `longLinks`/`topCount`/`bandRows`/`bandExtent` →
  `boxAreaHeight` ~1831 → `centerY` → `stackTop` ~1845 → node `top` ~1855 → `nodeOf` → `wants` →
  `incident`/`portOf` (port y ~1938) → `midpointOf`/`bandRow` → `crossing`/`levelKeys`/`laneIndex`/
  `maxLanes` → `laneX(rank,key) = (rank+1)*GEO.column + offset` (same-rank `levelLane`) → waypoints
  ~2167 → `curveOf(waypoints, radius)` ~2269 → marker/pointsLeft → `overlaps: overlapAudit(edges)`
  ~2302.
- **`GEO.nodeHeight` has only SIX uses**: 1831 (`boxAreaHeight`), 1845 (`stackTop`), 1855 (node tops),
  1897 (port order by counterpart middle), 1938 (port y), 2896 (`data-mpd-box` height). The router is
  otherwise HEIGHT-AGNOSTIC — it works from `node.top` + ports + `laneX`. That is why this is feasible.
- The single hard x assumption: `laneX = (rank+1)*GEO.column`, plus `CSS.column`/`gridTemplateColumns`
  and the DOM's `data-mpd-box` x (`rank*column + inset`). Variable widths therefore touch THREE
  expressions; the nested branch can bypass the column-grid DOM entirely (absolute divs).
- Model side already fits: a group is a pseudo-node with `visual:"group"`, `depth` = its column in the
  PARENT frame; interior nodes carry `group` = their INNERMOST frame. So
  `frameItems(frameId) = model.nodes.filter(n => (n.group ?? null) === frameId)` (root = `null`) and
  `frameEdges(frameId) = model.edges.filter(both endpoints in that item set)`. The core has already
  re-anchored cross-frame edges onto the group id, so the parent's router needs NO new routing code.

## Patch steps (each independently testable)

1. `ServedGraphModel` (~269): add `groups?: Array<{id,label,parentId,memberIds,depth,originTaskId?}>`;
   `ServedGraphModelNode` (~230): add `group?: string`, `visual?: string` (`subject?` already exists).
2. `GraphNode` (~370): add `height: number` and `left?: number`; set `height: GEO.nodeHeight` for
   tasks. Replace the six `GEO.nodeHeight` uses with per-item height / cumulative tops (per-column
   totals first).
3. Add `columnXOf(rank)` (cumulative widths) + `itemLeft(node)`; replace `laneX` ~2100 and the
   `data-mpd-box` x at 2896. Column width = max item width in that column (a frame item's width = its
   interior width + 2·pad).
4. Extract the body into `layoutFrame(frameId: string | null, originX, originY, payload)`;
   `layout(tasks, radius, served)` = `layoutFrame(null, 0, 0, …)` when `served.groups` is absent/empty
   (BYTE-IDENTICAL flat path — its arms pin the exact geometry) and the nested assembly otherwise:
   size each child frame bottom-up (`layoutFrame(childId, 0, 0)` → width/height), place it as an
   ordinary parent item, then re-emit its interior at `frameOrigin + local`.
5. Geometry: add `groups?: GraphFrame[]` (`{id,label,parentId,left,top,width,height,depth}`) +
   `overlaps` = union of per-frame audits (each frame's own router already yields []). Absolute
   coordinates everywhere; a parent edge terminates on the frame's border port because the re-anchored
   edge's endpoint IS the frame item.
6. DOM (~2860): when `graph.groups !== undefined`, emit a frames layer `div.mpd-dag-group` with
   `data-mpd-group="<id>,<left>,<top>,<w>,<h>"` BETWEEN the svg and the nodes, and node divs absolutely
   positioned (`left/top`) instead of the column grid; SKIP group pseudo-nodes in the node loop (they
   are frames, never `data-mpd-node`).
7. Tests: extend `entersInterior`/`segmentEntersInterior` (`test/team-view.test.ts` ~1460-1560) with
   frame rects, excluding the edge's OWN frame; fixture via `buildModel` from
   `../../mpd-graph-core/src/model.ts` with `{board, groups:[{id,label,board}]}`; arms: strict nesting,
   `overlaps === []`, DOM order svg→frames→nodes, built `client.js` carries `.mpd-dag-group` (rebuild
   via `node scripts/build-mpd-client.ts`), README pair, pinned-toolchain rebuild of
   `mpd-bundle-plugin/dist`.
8. TRAP: the flat path must stay byte-identical — its arms compare exact JSON/geometry strings
   (`data-edges`/`data-mpd-edge` counts, `data-mpd-curve` equality), so the nested branch must not
   alter the flat branch's emissions.

## Verification set on exit

`bun test packages/mpd-bundle-plugin`; `bun run typecheck`; `bun run verify:comments`; `verify:docs`;
`node scripts/build-mpd-client.ts` + the BUILT-artifact test (`test/client-harness.ts`); a grep of the
built `client.js` for `.mpd-dag-group`; `node scripts/verify-dist-fresh.ts` (rebuild only touched
dists, pinned `.toolchain` bun 1.4.0). Then freeze and mail `w4-verifier` for T8 (loop d3552b).
