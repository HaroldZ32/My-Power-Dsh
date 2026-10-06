# Requirements — wave `dag-edges-scroll` (WEB curved DAG edges + TUI bidirectional DAG panning)

Status: **FROZEN by the requirements conference** (captain + user, one consolidated batch of six
questions; every clause below is traceable to an answer, a code fact read during recon, or both).
This file is the input to the wave's staged plan; every task's acceptance is a clause here.

Wave branch: `feature/dag-edges-scroll`, stacked on `feature/tui-dag-port` (that branch is 4 commits
ahead of `dev` and unmerged, and the `dag` sidebar panel this wave extends exists only there).

## The user's request (verbatim)

> 优化WEB界面的依赖DAG的连线渲染（可以参考mermaid那种连线渲染，可以用曲线），TUI端的DAG图要做双向滚轴，
> 渲染可以参考 https://github.com/fasouto/termaid 渲染flowcharts，并且要求：这两个至少在图上不能有任何
> 中文字符，点击以后的描述上可以有，TUI这里的对齐对中文字符非常不友好

## User's decisions (verbatim answers)

| Question | User's answer |
|---|---|
| Scope of the CJK ban | **只禁 DAG 绘图本身：节点盒内文字 + 边 + 图例** — the drawing only; panel chrome (header/footer key hints) keeps whatever it has today |
| What a pure-CJK subject draws | **取 subject 里的 ASCII 片段；若没有则用 id+kind+序号** (e.g. `T3 REV #2`) |
| WEB edge shape | **圆角正交 + 入盒前一段曲线** — rounded orthogonal elbows, plus a cubic sweep into the final approach |
| TUI scroll keys | **方向键只管焦点，Shift+方向键才滚动** — arrows keep moving focus; Shift+arrow scrolls |
| TUI surfaces | **`dag` 面板 + 场景内嵌 DAG 都做** — the `dag` sidebar panel AND the in-scene DAG |
| TUI rendering depth | **完整：带留白多行节点盒 + 圆角拐角（`╭╮╰╯`）+ `▼` 入盒箭头 + `┬`/`├` 分流** |

## Recon facts this wave rests on (read during the conference, symbol-anchored)

- **WEB** `packages/mpd-bundle-plugin/src/team-view.ts`: the DAG's edges are absolutely-positioned
  `<div>` rectangles (`EdgeRect`, `DrawnEdge.segments`, `DrawnEdge.marker`, `routeText`,
  `data-mpd-route`, `data-mpd-edge`, `data-mpd-box`, `data-mpd-graph`) and the arrival marker is a CSS
  triangle. The edge doc-comment states *"A CSS triangle carries the marker: an SVG here would be a
  second drawing plane … and the frozen contract forbids one."* A task's `subject` is written verbatim
  into the node's second line, so a Chinese subject is drawn today.
- **TUI** `packages/mpd-tui-plugin/src/graph.ts` + `panel-dag.ts`: the DAG is a character grid
  (`mask`/`text`/`tone`/`wide`), `JUNCTION` carries SHARP corners only, node boxes are ONE content row
  tall, `GraphView.width` always fits the `cols` it was given, and `dagPanelLayout` falls back to
  rail/list when the boxes cannot fit. `panel-core.ts`'s `PanelViewport` is **vertical-only**
  (`offset`, `contentRows`, `viewportRows`, `clampScroll`, `gutterCells`, `panelScrollKey`).
- **Reference** `fasouto/termaid` (source read): charset `┌┐└┘` / `╭╮╰╯`, `─│`, tees `├┤┬┴`, cross `┼`,
  arrows `►◄▼▲`, `◇`, `○`, `×`, with an ASCII fallback set; node boxes are multi-row with the label
  centred inside padding rows; edge routing is orthogonal with rounded corners.

## Contract amendments this wave makes (BINDING — the wave's first act)

Both texts below currently forbid the change the user asked for. They are AMENDED, not ignored:

1. `docs/plan-webui-tui-i18n.md` §3 (the TASK DEPENDENCIES bullet): the phrase *"plain
   absolutely-positioned divs, no SVG, no measuring pass, so the drawing cannot disagree with the
   data"* is superseded by: **"drawn as an SVG path whose route is computed in the pure layout — no DOM
   read, no measuring pass, so the drawing still cannot disagree with the data."** The prohibition that
   SURVIVES is *measurement*; the prohibition on SVG does not.
2. `evidence/tui/dag-port/requirements.md` non-goal *"Web-plane changes: the WEB DAG itself is the
   REFERENCE and must not be modified."* is superseded for this wave: the user explicitly instructed a
   change to the WEB DAG's edge rendering, and the WEB DAG stops being a frozen reference.

## Acceptance criteria — C (CJK ban, both surfaces)

- **C1 · No CJK inside the drawing.** No character written into the DAG drawing — node box text, node
  row text (rail/list), edge glyphs, legend lines — may be a CJK/full-width character. Enforceable
  form: the drawing's text contains ZERO codepoints in U+2E80–U+2FFF, U+3000–U+303F, U+3040–U+9FFF,
  U+AC00–U+D7AF, U+F900–U+FAFF, U+FE30–U+FE4F or U+FF00–U+FFEF. The declared drawing glyphs (box
  drawing U+2500–U+257F, arrows/geometry U+25B0–U+25CF, ✓ U+2713, ✗ U+2717, ⊘ U+2298) are NOT in those
  ranges and stay allowed.
- **C2 · One composer per surface.** The graph-safe label is produced by ONE pure function per surface,
  called by every label write site; no renderer composes a label of its own from `subject`.
- **C3 · The detail is exempt.** The click/task-detail body keeps the ORIGINAL subject and description,
  Chinese included, untouched. Hover `title` attributes are tooltips, not drawing text, and stay
  original too.
- **C4 · The graph-safe label rule** is exactly: take the maximal runs of printable ASCII (`\x20`–`\x7E`)
  from the subject, join the runs with a single space, collapse whitespace, trim. If the result is
  empty, the label is the fallback `#<ordinal>`, where `<ordinal>` is the task's 1-based position in the
  board order the surface was handed; the node then reads `<glyph> <id> <KIND> #<ordinal>`. Pure:
  deterministic, locale-free, no I/O.
- **C5 · Proven.** An instrument feeds BOTH surfaces a board whose subjects are PURE Chinese and asserts
  C1 over the rendered drawing, with a negative control (the same assertion over the pre-rule input)
  proving the check is falsifiable.

## Acceptance criteria — W (WEB lane, curved edges)

- **W1 · SVG paths.** The edge layer draws one `<path>` per drawn edge; the `d` is a curve, not a
  rectangle.
- **W2 · Route is layout, never measurement.** The waypoints (the same lanes, the same reserved dummy
  rows, the same box anchors as today) are computed in the PURE layout function; the renderer only
  paints. No `getBoundingClientRect`, no DOM read.
- **W3 · Legibility stays mechanically provable.** Each edge publishes a FLATTENED POLYLINE of its curve
  (closed form, in the layout), sampled densely enough that a containment test can prove no sample
  enters any node box's interior. The test carries a POSITIVE CONTROL that injects a deliberately bad
  route and fails — an instrument that cannot fail is not evidence.
- **W4 · Marks.** `data-mpd-edge` (the witness) and `data-mpd-graph`'s `ranks=`/`edges=` counts keep
  their meaning exactly. `data-mpd-route` stays the ROUTE (the orthogonal waypoint rectangles) so it
  remains the routing truth; the NEW marks are `data-mpd-curve` (the `d`) and `data-mpd-tip` (the arrow
  tip rectangle).
- **W5 · Arrival.** The SVG arrowhead's TIP touches the border the edge arrives at — for a forward edge
  the dependent's left border, for a same-rank/back edge the right one — and this is asserted by
  arithmetic, not by eye.
- **W6 · Shape.** Rounded orthogonal elbows plus a cubic sweep into the final approach (the user's
  pick). One declared radius constant. **`radius = 0` must degrade to the straight orthogonal path** —
  that is this lane's falsifiability control.
- **W7 · Focus/hover tint survives** (stroke colour where the background colour used to change), and
  node dimming while a focus is held is unchanged.

## Acceptance criteria — T (TUI lane, bidirectional panning + termaid rendering)

- **T1 · Natural width exists.** A layout entry point sizes the drawing to its own content (node width
  from the widest graph-safe label, capped) INDEPENDENT of the viewport, so `GraphView.width` may exceed
  the cells available. The existing fit-width behaviour is preserved for every caller that does not opt
  in — `layoutBoxes`/`layoutGraph` keep their current semantics and their current tests.
- **T2 · Both surfaces pan.** The `dag` sidebar panel AND the in-scene DAG (`scenes.ts` team scene,
  `subagent-scene.ts`, the merged `panel.ts` view) render the natural width and pan it.
- **T3 · Cell-aware horizontal window.** ONE slicer cuts a span row to a column window; it never splits
  a wide glyph, and the visible slice is exactly the viewport width (padded when short). Asserted.
- **T4 · Two gutters, one position.** A horizontal gutter is drawn wherever a vertical one is, from the
  SAME single offset the page reads — no second scroller whose position the page cannot see.
- **T5 · Keys.** `↑↓←→` / `hjkl` keep moving FOCUS. `Shift+←→` scrolls horizontally, `Shift+↑↓`
  vertically (the scene's existing convention), `PgUp/PgDn` pages vertically, `Shift+PgUp/PgDn` pages
  horizontally, `Home/End` go to the vertical top/bottom, wheel `deltaY`/`deltaX` drive their own axis.
- **T6 · Focus auto-scroll is two-axis**: the focused node is brought FULLY into view on both axes.
- **T7 · termaid-like rendering.** Node boxes are bordered with rounded corners (`╭ ╮ ╰ ╯`), and carry at
  least one blank padding row above and below the content row when the vertical budget allows (a 3-row
  form is the compressed fallback). Edges use rounded corner glyphs at their turns, `─ │ ├ ┤ ┬ ┴ ┼` for
  runs and junctions, and a `▼` head whose tip touches the dependent's TOP border.
- **T8 · Legend and chrome stay ASCII** and still name both the entry arrow and the focus marker.
- **T9 · The three-mode ladder survives**: boxes when a legible box fits the NATURAL width, rail/list as
  the narrow fallbacks, with the same refusal semantics (`layoutBoxes` refusing rather than squeezing).

## Non-goals

- No change to the team record, `team-store`/`plan-store`, the routes, or the board's data.
- No new runtime dependency; no i18n/locale work outside the drawing.
- The WEB DAG's rank/column layout, inset arithmetic, dummy-row reservation and lane assignment are
  NOT redesigned — only the painted form of the route changes.
- The TUI's rank derivation (`deriveRanks`/`rankPlan`), cycle reporting, `hitTest` semantics and the
  six-state tone palette are NOT redesigned.

## Evidence requirements

- Every clause above is proven by a command run and an artefact on disk under
  `evidence/dag/dag-edges-scroll/<lane>/<timestamp>/`.
- The TUI's visual claims are proven on a REAL PTY capture; the WEB's visual claim is proven by a real
  browser capture of the rendered panel, not by a unit test alone.
- A red gate is reported as red, with the command and its output.
