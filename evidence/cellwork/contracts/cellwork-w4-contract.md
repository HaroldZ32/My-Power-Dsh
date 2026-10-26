# Wave 4 frozen contract — nested DAG groups (subcell boxes)

Frozen: 2026-10-26T10:02:00Z · owner: captain · basis: `.mpd/plans/cellwork.md` §4.13 and the
2026-10-26 DAG reconnaissance (one flat `GraphModel`; the TUI is a glyph grid; the web DAG is the
authored `mpd-bundle-plugin/src/team-view.ts` spliced into the committed `client.js`).

The requirement: a subcell renders as a BOX whose interior is that subcell's own DAG; dependencies from
outside attach to the box; nesting repeats recursively.

A Wave-4 verifier works from THIS contract, the plan, the package READMEs and `docs/tui-dag-renderer.md`
— never from `src/**` before a FAIL is recorded.

## D1 — One group concept in the shared model (`packages/mpd-graph-core`)

- `GraphModel` gains an OPTIONAL `groups?: GraphGroup[]`; `GraphGroup = {id, label,
  parentId: string | null, memberIds: string[], depth: number, originTaskId?: string}`; a node may carry
  `group?: string` naming the INNERMOST group. The model stays plain JSON (a `JSON.parse(JSON.stringify())`
  round-trip deep-equals) and byte-deterministic; no Map/Set/class instances.
- **Attachment rule (binding):** an edge with one endpoint inside group G and the other outside is
  re-anchored to G's frame, where G is the INNERMOST group containing the inside endpoint; an edge fully
  inside a group stays inside; an edge between two groups becomes group→group; a group's spawn edge from
  its `originTaskId` (when present) is DERIVED, not authored.
- **Ranking:** the outer model ranks GROUP PSEUDO-NODES (one per child team) so external columns stay
  correct; each group's interior is ranked as its own model; recursion preserves determinism.
- `buildModel` accepts the grouping input; with NO groups supplied the output is byte-identical to today
  (backward compatibility is a test).
- `scripts/verify-graph-model.ts` gains a group arm and a seeded negative; `--self-test` proves both
  directions. README pair updated.

## D2 — Team projection (`packages/mpd-team-core-plugin`)

- Additive `TeamRecord.parentTeamId?: string`; an absent field means a root team (readers tolerate both).
- **The SEAM is a decision the D2 verdict must NAME:** either (a) an explicit `parentTeamId` on
  `agent_teams_plan create` (and `edit`), or (b) implicit derivation from the staging session's own
  team record (the session is a member of the parent team, so the record already knows). D5 follows the
  chosen shape — (a) adds an argument to the sub-team creation path, (b) shrinks D5 to the arm plus the
  journal field. Neither shape may require a write outside the owning packages.
- `agent_teams_plan create` accepts `parent_team_id` (Lead-authorized) and validates: the parent record
  exists and is live, and the parent chain has NO cycle. The depth CAP stays cellwork's (`depth.max`),
  not team-core's.
- `mpdTeams.graph(workspace, teamId)` merges descendant teams (by `parentTeamId`) as nested groups,
  recursively; `/plugins/mpd-team/state`'s `model` carries `groups`, and per-task `rank` remains the
  OUTER rank. A tree with no children produces exactly today's model.
- Tests: a two-level fixture, a three-level fixture, determinism, and the no-children backward case.

## D3 — TUI rendering (`packages/mpd-tui-plugin`)

- `dag-theme.ts` gains a SECOND glyph border family, visually distinct from node borders; every glyph
  stays one cell (`DAG_CHARS_ONE_CELL` remains true).
- `graph.ts` draws a group frame spanning its interior's rows; an edge CROSSING a group border is
  distinguished from one TERMINATING on it (the re-anchored port); `GraphHit` gains a group identity.
- `panel-dag.ts`: "never draw half a GROUP" (the existing per-node rule extended), and a width guard
  that degrades to the existing rail/list mode with the group shown COLLAPSED rather than half-drawn.
- Tests: a synthetic nested model draws the frame; no partial group is ever emitted; the group hit
  identity resolves; the width degradation path is exercised.

## D4 — Web rendering (`packages/mpd-bundle-plugin`)

- `src/team-view.ts`: a `.mpd-dag-group` frame; recursive geometry kept in ONE pixel canvas so
  `overlapAudit` (no two edges share a run) and "no run crosses a box" extend to group frames; group
  ports for re-anchored edges; an explicit z-order (SVG edge layer < group frames < nodes).
- Rebuild `client.js` with `node scripts/build-mpd-client.ts` — it is NOT covered by
  `verify-dist-fresh`, so the contract REQUIRES the rebuild AND a test on the BUILT artifact
  (`test/client-harness.ts`) plus the source tests.
- README pair updated.

## D5 — Cellwork integration (`packages/mpd-cellwork-plugin`)

- When a promoted subcaptain stages its sub-team, cellwork passes `parent_team_id` through
  `agent_teams_plan create`; the existing depth fence still guards the cell level.
- The cellwork README pair notes that subcells render as nested groups.

## D6 — Documentation

- `docs/tui-dag-renderer.md` + `docs/tui-dag-renderer.zh-CN.md`: the nested-group decision, the glyph
  border family, the collapse rule.
- `docs/cellwork.md` + `.zh-CN.md`: a nested-DAG section (groups, external-edge attachment, recursion).

### Amendment 7 (2026-10-26T11:20Z, captain; from the T1 model report)

D2 must QUALIFY child-team task ids before building the model, because every team mints ids from the
same `T1..Tn` space while the model's id is the join key both renderers draw by.

- Spelling: `<teamId>::<taskId>` for a non-root team (the spelling `dispatch.ts` already uses in
  `ledgerKey`); root-team ids stay BARE. `originTaskId` and any cross-team `blockedBy` reference use the
  same spelling (a child task blocked by the parent's `T3` names bare `T3`; a reference to a sibling
  subcell task names `teamB::T2`).
- `buildModel` REFUSES an id present in two frames with an error naming both frames.
- D2's input is a TREE: `buildModel({ board, plan, groups: [{ id, label, originTaskId?, board?, plan?,
  groups?: [...] }] })`.
- Output: `GraphModel.groups` is flat and shallow-first, each group is ALSO a pseudo-node in `nodes`
  (`visual:"group"`, `subject`=label, `dependencies` = blockers anchored on its border, `depth` = its
  column in the parent frame); every interior node carries `group` = innermost frame and `depth` = its
  column INSIDE that frame; `ranks` buckets the ROOT frame only. `GraphEdge.source` gains `"derived"`
  for the spawn edge the model derives from `originTaskId`.

### Amendment 8 (2026-10-26T11:30Z, captain; from the D1 writer's self-report)

D1 has a REAL ranking divergence, admitted by the writer before the T4 record: when an OUTER task is
blocked by a task INSIDE a subcell, the drawn edge is anchored on the group box, but each frame's
ranking and cycle scan are derived from the AUTHORED refs — which do not resolve inside the root frame.
The outer task therefore ranks as a root (depth 0) while the picture draws a line into it. The mirror
case (an inner task referencing an outer one) is consistent.

Accepted repair items for T11, judged by T12 against this amendment:

- **R1 — anchored ranking.** Build each frame's ranking and cycle scan from the ANCHORED pairs (the
  `from` of every pair whose `to` is the node) instead of `node.dependencies`, and keep
  `node.dependencies` as the AUTHORED text in the output. Update the gate's grouped oracle the same way.
  Add a test for the outer-blocked-by-inner case AND for a cross-frame mutual block (`T1` blocked by
  `G1`, `G1` blocked by `T1`) reported as a CYCLE instead of two silent roots.
- **R2 — gate-level group→group proof.** A package arm already asserts the group→group attachment, but
  the BUILT-IN gate fixture never produces it. Extend the fixture, the grouped oracle and the golden so
  the gate demonstrates it too.

### Amendment 9 (2026-10-26T11:38Z, captain; from the verifier's independent measurement)

Two T2-owned reds on the T1-freeze tree, repaired under T13 (blocked by T5) and judged by T14:

- **R1 — D5 acceptance arm fails.** `D5: a registered sub-cell records the parent cell's TEAM id, and
  the parent cell keeps only its own` fails with `Received: ""` — the parent team id is not stamped on
  the sub-cell record. Fix the derivation/stamping (the seam is (b) implicit derivation) so the arm
  passes, and keep the parent cell record naming only its own team.
- **R2 — the cross-package coupling inventory is red.** The wave added a cross-package import and the
  frozen inventory in `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`
  was not updated, so the repo's independence gate fails. PREFERRED fix: remove the import and reach
  the capability through the registered service. If the edge is genuinely required, update the frozen
  inventory DELIBERATELY with the edge named and a one-line justification in the test's comment, and
  state it in the report — an inventory edit is a design decision, never a test-greening trick.

Scope: the T2 lane's packages, plus that inventory test file only if R2's preferred fix is impossible.

## Gates the verifier must run

- `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, `bun test packages`,
  `node scripts/verify-dist-fresh.ts` (graph-core, team-core, tui, bundle, cellwork),
  `bun run verify:rows`, `bun run verify:manifest`, `node scripts/verify-no-host-override.ts`,
  `node scripts/install-profile.ts --dry-run`.
- `node scripts/verify-graph-model.ts --self-test` AND its group arm.
- The web client rebuild is a required artifact: `node scripts/build-mpd-client.ts` then the
  built-artifact test; the committed `client.js` must carry the group code.
- Evidence under `evidence/cellwork/dag-groups/<timestamp>/`.

## Declared bounds (not findings)

- The TUI remains a character grid; there is no per-group host `ui.Box`.
- A group that cannot fit the width is COLLAPSED to the rail/list mode; it is never half-drawn.
- v1 authors only the derived spawn edge plus the re-anchor rule; arbitrary cross-team dependency edges
  are not newly authored (any that exist are re-anchored).
- The model must stay plain JSON and deterministic; a change that introduces a class instance or a Map
  is a finding.
