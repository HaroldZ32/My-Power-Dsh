# Wave contract — WEB DAG redesign + better-sidebar 0.28 secondary adaptation

Status: FROZEN 2026-10-21. Branch `feature/web-dag-sidebar-028`, cut from `dev` at `2718ff4b`.
Owner (integration, git, commits): the captain. Writers: lanes below. No writer runs git write commands.

## 1. User request (acceptance clauses, verbatim intent)

1. Upgrade the **secondary adaptation** of `dsh-better-sidebar` to **v0.28.0**; both the official-right-sidebar
   fallback AND the better-sidebar bottom workbench are in scope.
2. The hierarchical-task DAG in the WEB UI must:
   - be as symmetric as possible about the whole graph's horizontal axis;
   - change dynamically when tasks/ranks change;
   - draw connector lines between node cards without overlapping straight segments, in a
     mermaid-state-diagram-like visual grammar (orthogonal runs, rounded corners, arrowheads into the border);
   - animate clear directional arrows on completed -> active edges;
   - give every node card a frosted-glass look against the background;
   - give active nodes an obvious breathing effect that does NOT harm overlaid text legibility;
   - on hover, show a small rounded semi-transparent white box with black text and a thin border beside the
     cursor, containing status, owner, elapsed time, a rough task line, and completion progress;
   - after a click (pin), a subsequent hover shows the same box OPAQUE;
   - the box closes automatically on mouse leave;
   - keep every existing UI feature; match the existing style rather than replace it.
3. The user selected: direct 0.28.0 upgrade, both secondary surfaces, full implementation (including
   `startedAt` / `finishedAt` and a coarse progress field).

## 2. Definition of done

- `dsh-better-sidebar` is pinned at **0.28.0** in all four carriers, `bun.lock` resolves 0.28.0, and the
  host shim mounts against 0.28's `connection` service.
- Both surfaces register the team/workmate/watchdog pages: native right sidebar (primary + official
  fallback) and the bottom workbench (`bottomOnly` descriptors); the fallback still works when
  better-sidebar is absent.
- The DAG implements every clause in §1.2; `layout()` stays pure and testable without a browser.
- `startedAt` / `finishedAt` are stamped by the single `updateTeamTask` seam; the WEB payload serves them
  plus a documented coarse `progress`; no record version bump; no explicit `undefined` keys.
- All existing tests, TUI parity, and the frozen DOM vocabulary still pass (updated deliberately where the
  contract says SHOULD UPDATE).
- `client.js` is rebuilt from source; `packages/mpd-better-sidebar-host/dist` and
  `packages/mpd-team-core-plugin/dist` are rebuilt when their sources change.
- Required gates pass, evidence lands under `evidence/web-dag/sidebar-028/<UTC timestamp>/`, and the PR
  description is bilingual (English first, then 简体中文) with measured evidence and honest bounds.

## 3. Lane ownership (disjoint file scopes)

| Lane | Writer | Owns | Depends on |
|---|---|---|---|
| S — sidebar | Senior Engineer | `package.json`, `bun.lock`, `scripts/pack-mpd.ts`, `packages/mpd-better-sidebar-host/**` (src, test, dist), `packages/mpd-bundle-plugin/src/web-client.ts`, `packages/mpd-bundle-plugin/src/team-page.ts`, sidebar tests, sidebar docs (`docs/user-guide*`, `docs/development*`, `docs/independence*`, `agent-references/troubleshooting.md`, `AGENTS.md` version prose, `packages/mpd-better-sidebar-host/README*`), `locale/{en,zh}.json` if new strings | none |
| D1 — layout | Senior Engineer | `packages/mpd-bundle-plugin/src/team-view.ts` (layout/routing only), `packages/mpd-bundle-plugin/test/team-view.test.ts` | none |
| DATA — lifecycle | Senior Engineer | `packages/mpd-team-core-plugin/src/team-store.ts`, `packages/mpd-team-core-plugin/src/team-web.ts`, `packages/mpd-team-core-plugin/test/team-store.test.ts`, `test/team-web.test.ts` | none |
| D2 — visual | Deep Worker | `packages/mpd-bundle-plugin/src/team-view.ts` (visual/tooltip/data consumption), `packages/mpd-bundle-plugin/test/team-view.test.ts` (visual arms), `packages/mpd-bundle-plugin/src/web-client.ts` (i18n keys only) | D1 + DATA + S (serialize after them) |
| DOCS | Senior Engineer | `docs/user-guide*` DAG section, any `docs/plan-*` record, changelog note | D1 + D2 + DATA |
| VERIFY | Reviewer | read-only verdict | all |

Rules: a lane never edits another lane's files; a lane never weakens a test to pass; no git writes; no
`client.js` edits by hand (captain rebuilds after D2); no `dist/*` hand edits (rebuild with the pinned
bun).

## 4. Frozen interfaces

### 4.1 `packages/mpd-bundle-plugin/src/team-view.ts` build/test envelope

- File starts with `// mpd bundle web client`; it is ONE arrow expression whose opener is the ONLY
  column-0 line starting `(require: ` and ending `=> {`; the last non-empty line is `}`. No top-level
  `import`/`export`, no JSX, `React.createElement` only.
- File-wide forbidden identifiers (tests W2): `getBoundingClientRect`, `requestAnimationFrame`,
  `ResizeObserver`, `getComputedStyle`, `offsetWidth`. In the layout region and the paint region, also
  forbidden: `document.`, `querySelector`. Additive CSS must be a rendered `<style>` element or inline
  style objects — never a measurement API.
- Keep these anchors verbatim: `const GLYPH: Record<string, string> = {`,
  `const TONE: Record<string, string> = {`, `const KIND_KEY: Record<string, string> = {`,
  `const EN: Record<string, string> = {`, `const GEO = {` (flat numeric keys
  `column/inset/nodeHeight/nodeGap/pad`), `const EDGE_RADIUS = 6`.
- Keep the returned members: `TeamView`, `start`, `read`, `layout`, `graphSafeLabel`, `curveOf`; keep the
  deps signature `{ react, statePath, planPath?, taskPath?, eventsPath?, pollMs?, t? }`.
- Keep the DOM vocabulary and value grammars: `data-mpd-team-tab`, `data-mpd-workspace-teams`,
  `data-mpd-workspace-team`, `data-mpd-workspace-active`, `data-mpd-graph` (`ranks=<n> edges=<n>`),
  `data-mpd-focus` (`chain|none`), `data-mpd-rank`, `data-mpd-node`, `data-mpd-box`
  (`left,top,width,height`, layout coords), `data-mpd-box-rank`, `data-mpd-planned`, `data-edges="1"`,
  `data-mpd-edge` (`<child><-<parent>`), `data-mpd-route`, `data-mpd-curve` (must equal `curve.d`),
  `data-mpd-head="1"`, `data-mpd-tip` (`x,y-4,0,8`, zero width), `data-mpd-detail`, `data-detail-close`,
  `data-member`, `data-progress`.
- Counts: one `data-mpd-edge` group per drawn edge; exactly one `data-mpd-curve` path and one
  `data-mpd-head` polygon inside each group; no decorative element may carry a counted attribute.
- Rank source (R20): `task.rank` when finite wins; `depth` is only the no-model degrade; no client-side
  derivation from `blockedBy`; contiguous columns keep empty ranks. `ranksDerived` only from
  `served.report.ranksDerived === true`. `unresolved` = sorted unique union of record
  `unresolvedBlockers` + `served.report.unresolved`; `unresolvedRecorded` = the record half.
- `curveOf` grammar: `M/L/Q/C` only; 2-decimal formatting, `-0` -> `0`; fillet
  `min(radius, legIn/2, legOut/2)`; last corner is the cubic arrival sweep; radius 0 returns the
  waypoints exactly. Keep the byte-exact radius-0 control path
  `M 164 25 L 168 25 L 168 77 L 172 77` reachable for the frozen waypoints.
- Text rules: drawing text CJK-free (7 ranges); `title` and pinned detail keep the original subject; node
  legend kind is ASCII (`REQ/WRK/REV/FIX/INT`); detail kind is localized; `graphSafeLabel` contract
  unchanged; every view-owned string goes through `t` with an English fallback.

### 4.2 Sidebar

- 0.28 host manifest: `inject = ["webServer","sessions","connection","tools"]`. The shim must restate
  `connection` (not the retired `webRuntime`), mount only when `connection` is present, and keep the
  diagnostics. `host-contract.test.ts` compares the restated list to the shipped host's list.
- `registerTab` descriptor remains compatible; 0.28 additions are `bottomOnly` (0.26+) and
  `rightActions` (0.25+). Use `bottomOnly: true` for the bottom-workbench duplicates.
- Primary (better-sidebar) registration stays: `mpd-team`, `mpd-workmate`, `mpd-agent-teams`; fallback
  (official right sidebar) stays functional and gets the same guide/description parity.
- Bottom workbench duplicates: ids `mpd-team:bottom`, `mpd-workmate:bottom`,
  `mpd-agent-teams:bottom`; same component/body; `single: true`; `bottomOnly: true`; title/icon/order
  from the primary descriptor; never registered when `ctx.betterSidebar` is absent.
- No duplicate registration: `getTab`/idempotence guard per id.

### 4.3 Team record / wire

- Add optional `startedAt?: string` and `finishedAt?: string` to `TeamTaskRecord`; ISO-8601 UTC ms
  strings. Stamp them in `updateTeamTask` from the status transition:
  into `in_progress` -> `startedAt` if absent; into `completed|failed` -> `finishedAt`; reopening to
  `pending|claimed|in_progress` -> remove `finishedAt`. `addTeamTask` stays unchanged. Do not bump
  `version: 1`.
- Serve `startedAt` / `finishedAt` via conditional spreads in `buildTeamState`; never emit a key with an
  explicit `undefined`.
- Serve `progress: number` (0–100) derived read-side from the visual with this documented mapping:
  `completed` 100; `running` 50; `claimed` 10; `pending` 0; `failed`/`cancelled` 0. Label it as coarse in
  the UI; do not claim it is measured work.
- Mirror the optional fields in the hand-declared client `TeamTask` interface in `team-view.ts`.
- `updatedAt` is NOT a finish stamp; duration must come from `startedAt` -> `finishedAt`/now.

## 5. New behavior

### 5.1 Layout (D1)

- Keep `GEO` pixel constants and `EDGE_RADIUS`; do not add a layout library.
- Order nodes within each rank by a small number of barycenter sweeps (parents then children), stable on
  ties, to reduce crossings.
- Center every column's stack on the global horizontal midline (`centerY`); single-node columns keep
  `top = 4`; empty ranks stay.
- Allocate per-node ports: a node with one incident edge keeps the border middle; multiple edges spread
  over distinct y offsets inside the node height, ordered by the counterpart's y. This is the primary
  anti-overlap device for lead-out/lead-in runs.
- Allocate gutter lanes in y order, mirrored about the gutter centre (`0,+1,-1,+2,-2...`); all lanes
  distinct and strictly inside the gutter; `laneOverflow === 0` for normal fixtures.
- Long edges (rank-skipping) route through a symmetric top/bottom crossing band with distinct rows, never
  through a node card; assign half the edges to the top band and half to the bottom band (mirrored),
  ordered by midpoint y. Keep the existing segment-key vocabulary; if the current test asserts
  below-only crossing, update it deliberately to allow a top or bottom band.
- Add a pure `overlapAudit` (or equivalent) that returns collinear segment overlaps between different
  edges; add `overlaps` to the `GraphGeometry` return (additive). It must be empty for the TASKS,
  LONG_EDGE_TASKS and CYCLE_TASKS fixtures.
- Add `centerY` (and, if useful, per-column centres) additively for symmetry tests.
- Keep `layout(tasks, radius?, served?)` and its existing return fields.

### 5.2 Visual (D2)

- Node cards: frosted glass via a scoped CSS class + `backdrop-filter: blur(...) saturate(...)`, a
  translucent host-token background with an opaque fallback, a 0.5px border, a soft shadow, and a dark
  text colour with sufficient contrast. Keep node text legible; do not put the breathing opacity on the
  text layer.
- Active (`running`) nodes: breathing ring/glow on a pseudo-element, `transform`/`opacity` only,
  `prefers-reduced-motion` disables it. The node's text and border stay stable.
- Layout dynamics: position nodes with `transform: translate3d(...)` and transition transform (and
  opacity/border/shadow) with a short easing; edge paths get a draw-in animation on path change.
- Completed -> running edges: a moving directional arrow along the path (SVG `animateMotion` with a small
  arrow polygon in a separate overlay layer, no counted attributes) plus a subtle dash flow on the main
  path. Other edges stay static. Do not animate the whole graph.
- Hover card: a fixed-position card beside the cursor, outside the `[data-mpd-graph]` subtree (so CJK
  rules do not apply), white translucent background, thin border, rounded corners, black text, small
  shadow, `pointer-events: none`. Contents: status, owner, elapsed time, rough subject, progress bar.
  On a pinned node the card is opaque; otherwise semi-transparent. It closes on mouse leave. Keep the
  existing click-to-pin detail body. Track the cursor from the React mouse event (`clientX/clientY`) and
  clamp with `window.innerWidth/innerHeight`; no measurement APIs.
- Add a 1s `now` ticker only while a running task is visible, for elapsed time; clean it up on unmount.
- Add i18n keys for the card/status/progress/owner/duration; English fallback must work when `t` is
  absent or throws.
- Keep the existing hover halo semantics and pinned detail unchanged.

### 5.3 Sidebar (S)

- Move all four pins to 0.28.0; widen the optional peer to `>=0.28.0 <0.29.0`.
- Update the shim for `connection`; keep `hostUrl()` resolution; keep `webApp` diagnostics if still
  meaningful, but the mount dependency is `connection`.
- Add bottom-workbench descriptors and the fallback parity; update tests/docs accordingly.
- Do not edit `team-view.ts` or `team-core` (other lanes).

## 6. Acceptance tests (minimum)

- `team-view.test.ts`: every existing arm still passes after deliberate updates; new arms for
  symmetry (`centerY`), zero overlaps, port separation, long-edge band, flow arrow only on
  completed->running, glass/breathing markers, hover card content/opacity/close, duration formatting,
  progress bar. Test source text, not a browser.
- `team-store.test.ts` / `team-web.test.ts`: transition stamps, payload fields, no `undefined` keys,
  progress mapping.
- `sidebar-tab.test.ts` (or equivalent) / `host-contract.test.ts`: 0.28 inject list, bottom-only
  descriptors, fallback still registers.
- TUI parity (`dag-fidelity.test.ts`, `dag-label-parity.test.ts`) stays green; do not edit its GEO
  anchors.
- `bun test packages/mpd-bundle-plugin packages/mpd-team-core-plugin packages/mpd-tui-plugin`
- `bun run typecheck`
- `bun run verify:comments`
- `bun run verify:docs` if docs changed
- `bun run verify:rows` / `node scripts/verify-graph-model.ts --self-test` / `node scripts/verify-dist-fresh.ts`
- `node scripts/build-mpd-client.ts` (captain, after D2)
- Docker UI capture lane if Docker is available; otherwise record the honest skip.

## 7. Evidence and reporting

- Evidence root: `evidence/web-dag/sidebar-028/<UTC timestamp>/` with `result.json`, `output.log`, gate
  logs, and a short `README.md` mapping each user clause to its test/evidence.
- Each writer reports: files changed, commands run with observed results, unresolved risks, and a
  `git diff --stat`-style summary. No claims without a command or a file reference.
- The captain commits; the PR body is bilingual and cites the evidence paths.

## 8. Non-goals

- No new runtime dependency; no mermaid/dagre import; no bundler.
- No zoom/pan/minimap in this wave (listed as a follow-up optimization).
- No record `version` bump, no new task status, no new tool.
- No change to the TUI geometry; WEB semantics remain the reference.
