# feat(dag): curved WEB edges and a pannable TUI DAG, with zero CJK inside either drawing

Branch `feature/dag-edges-scroll` — **stacked on `feature/tui-dag-port`** (that branch is 4 commits ahead
of `dev` and unmerged, and the `dag` sidebar panel this wave extends exists only there, so the PR base
should be that branch rather than `dev` until it lands).

## English

### What changed, and why

The user asked for two things in one breath: the WEB dependency DAG's **connection lines** should be
optimised with mermaid-like **curves**, and the TUI DAG should get a **bidirectional scrollbar** with
rendering closer to [termaid](https://github.com/fasouto/termaid)'s flowcharts — plus a hard constraint:
**neither drawing may contain a single Chinese character**, while the description shown after a click may.
The reason given was concrete: terminal alignment is hostile to CJK.

Six decisions were taken with the user before any code (their verbatim answers are in
`evidence/dag/dag-edges-scroll/requirements.md`), and everything below implements one of them.

**WEB (`packages/mpd-bundle-plugin/src/team-view.ts`).** The edge layer stopped being absolutely-positioned
`<div>` rectangles and became ONE `<svg>` holding one `<path data-mpd-curve>` per drawn edge plus one
`<polygon data-mpd-head data-mpd-tip>` arrowhead. The ROUTE is still computed in the pure layout — the same
lanes, the same reserved dummy rows, the same box anchors — and the curve is a parametrisation of the
SAME waypoint list that produces the rectangles, so the published flattened polyline provably describes
what is painted. `data-mpd-route` stays byte-identical and is still the routing truth; the new marks are
`data-mpd-curve` (the `d`) and `data-mpd-tip` (a zero-width rect whose `left` is the arrival tip in LAYOUT
coordinates). The geometry was retuned (`GEO.inset 4 → 12`) so the declared 6px radius is not clamped
away: gutter 8px → **24px**, node width 160px → **144px**, emitted fillet 2px → **6px**.

**TUI (`packages/mpd-tui-plugin/src/**`).** The drawing gained a NATURAL width — sized from the widest
graph-safe label rather than squeezed into the panel — so `GraphView.width` may now exceed the viewport,
and a single cell-aware slicer (`sliceCells` in `sanitize.ts`, `sliceSpans` in `graph.ts`) windows it to
exactly the viewport width without ever splitting a wide glyph. The horizontal axis rides on the SAME
`PanelViewport` handle as the vertical one and reuses the same `clampScroll` band — one offset per axis,
no second scroller. The four legacy layout entry points (`layoutBoxes`/`layoutRail`/`layoutList`/
`layoutGraph`) keep their exact signatures and fit-width semantics. Rendering moved toward termaid: a
roomy 5-row box with padding rows and a 3-row compressed fallback chosen from the vertical budget, rounded
`╭ ╮ ╰ ╯` corners declared once in `dag-theme.ts` as `DAG_CHARS`, `─ │ ├ ┤ ┬ ┴ ┼` runs and junctions, and
a `▼` whose tip touches the dependent's top border.

**Clause R8 (the user's own narrowing).** The horizontal window belongs to the **DAG drawing only**. The
panel header, legend, pinned detail body, member rows and footer render at FULL surface width and are
neither moved sideways nor cut. Reading the requirement literally as "the page scrolls horizontally"
would have been the defect this ruling exists to prevent.

**TWO MORE DEFECTS, FOUND BY THE REAL PTY CAPTURE AND NOT BY ANY UNIT TEST.** This is the single most
useful thing in the wave, so it is recorded rather than summarised:

1. **The panel was drawing a RAIL, not boxes, at every width.** `dagPanelLayout` falls back to the rail
   when the layout reports `labelOverflow`, and the natural path clamped `nodeWidth` to the shared
   `MAX_NODE_WIDTH = 34`, so ANY graph-safe label longer than 32 cells tripped it — which is every
   realistic board. The user's headline feature (termaid-style boxes you pan across) was therefore
   invisible in the sidebar, and `⇧←→` moved nothing because a rail has no horizontal extent. Fixed with a
   SEPARATE `NATURAL_MAX_NODE_WIDTH = 64` for the natural path, leaving the fit-width cap at 34 so clause
   T1's frozen geometry is untouched. The cap change then exposed a second, shipped bug: the label budget
   was a GLOBAL constant correct only at `nodeWidth === 34`, so below it the label wrote over the right
   border while `labelOverflow` stayed `false` and nothing fell back — a silent cut. Both are fixed, and
   `labelOverflow` is now derived from the clamp's own condition so the report and the truncation cannot
   disagree again.
   **WHAT THE CAP DOES AND DOES NOT BUY, stated precisely because the capture measures it.** A board whose
   graph-safe labels fit inside 64 cells now draws BOXES that you pan; a board with a longer label still
   falls back to the rail, and that fallback is clause T9's safety net working. The PTY capture's own
   fixture sits **three cells outside** the cap (its widest label is 67), so on THAT fixture the panel
   refuses a box in both builds — which is why `pty-post → pty-fixed` shows `rail → rail` with C1 going
   green and C3 becoming reachable, and why the boxes are demonstrated separately by `pty-fixed2` on a
   fixture whose longest label is 59. Three cells is the whole difference, and the boundary is declared
   rather than tuned away: a 100-cell cap would let a 70-cell label produce a ~206-cell drawing a 44-cell
   panel must be panned across five screens, while the rail shows every task on one line.
2. **Clause C3 was genuinely UNSATISFIED on the TUI, not merely unwitnessed.** The pinned detail body
   printed ten metadata facts and NEITHER original field, and the task row dropped the record's
   `description` entirely — so the Chinese had nowhere to appear. Both are now carried and rendered.

**The CJK ban (both surfaces).** One composer per surface, `graphSafeLabel(subject, ordinal)`, applied at
every site that writes task text INTO the drawing: printable-ASCII runs joined by single spaces, and the
`#<ordinal>` fallback when nothing printable survives. The click/pin detail body and hover tooltips keep
the ORIGINAL subject verbatim.

**Contract amendments.** Two existing texts forbade this wave, so the wave's first act was to amend them:
`docs/plan-webui-tui-i18n.md` §3's *"plain absolutely-positioned divs, no SVG, no measuring pass"* is
superseded by *"drawn as an SVG path whose route is computed in the pure layout — no DOM read, no
measuring pass"* (the prohibition that SURVIVES is measurement), and
`evidence/tui/dag-port/requirements.md`'s non-goal *"the WEB DAG itself must not be modified"* is marked
superseded, since the user explicitly instructed a change to it.

**A second, independent defect, found and fixed.** While fixing the user's separate report that the TUI
sidebar showed only the host's builtins, the repair lane reproduced the cause with an in-process probe and
a STACK TRACE: the host's `dsh-tui` row re-applies its own config (`applySidePanelPanels(config.sidePanel?
.panels)`, reached from `Fiber._reload`) about **4.3 s after** our registration append, discarding every id
we added. Its fix is a version-gated, BOUNDED re-assert in `mpd-tui-adapter-plugin` plus a one-command
durable route, `scripts/mpd-tui-panels.ts`. The re-assert stands down the moment the enable list names ANY
of our ids, so it repairs a stock profile without ever overruling a user who has configured the list.

### Measured evidence

| Claim | Artefact |
|---|---|
| The user's requests, frozen with their verbatim decisions | `evidence/dag/dag-edges-scroll/requirements.md` |
| Design freeze (curve contract, natural-width entry point, glyph table, risks) | `evidence/dag/dag-edges-scroll/design-freeze.md` |
| Captain rulings R1-R8 reconciling the plan against the freeze | `evidence/dag/dag-edges-scroll/captain-rulings.md` |
| WEB lane: curved edges, radius-0 control, label rule, `data-mpd-route` byte-identity | `evidence/dag/dag-edges-scroll/web/20261006T151234Z/`, `…/20261006T151605Z/` |
| Captain's OWN independent containment check (mine, not the lane's) | `evidence/dag/dag-edges-scroll/captain/20261006T152037Z/` |
| Captain's OWN independent check of the cap fix and clause C3 | `…/captain/20261006T152037Z/{captain-tui-check.mts,tui-check-output.log}` |
| `docker/**/*.mts` type-coverage measurement (recorded, not fixed) | `…/captain/20261006T152037Z/tsconfig-mts-coverage.md` |
| TUI lane: pan windowing + the CJK proof with a falsifiable control | `evidence/dag/dag-edges-scroll/tui/20261006T162524Z/` |
| Reviewer's independent instruments + numbered findings | `evidence/dag/dag-edges-scroll/review/2026-10-06T14-57-30Z/` |
| Real browser capture (curves, tips, both C4 branches, negative control) | `…/verify/20261006T145633Z/captures/web-rerun/` |
| Real PTY capture, pre-wave baseline and post-wave, 3 widths | `…/verify/20261006T145633Z/captures/{pty,pty-post}/` |
| Real PTY capture AFTER the cap fix (`pty-fixed` unshortened, `pty-fixed2` shortened fixture) | `…/verify/20261006T145633Z/captures/{pty-fixed,pty-fixed2}/` |
| Panel-visibility arms A-E (loss, control, keeper, degrade, remedy) | `evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/` |
| Panel-visibility arms C/D **re-verified across a REBUILD** (same readings on two independent `dist` builds) | same directory, `REPORT.md`'s "re-verified across a REBUILD" section |

The captain's own check is deliberately separate from the lanes': a segment-vs-box-interior test written
from the definition, over 106 published samples → **0 invasions**, with a positive control (every polyline
shifted 40px) catching **91** — so the zero is a measured zero rather than an instrument that cannot fail.

### Gates run, with the observed result

| Gate | Observed |
|---|---|
| `bun test packages` | **1847 pass / 3 skip / 0 fail**, 147 files |
| `bun test packages/mpd-tui-plugin/test` | **382 pass / 0 fail** (pre-wave baseline **332 / 2**) |
| `bun test packages/mpd-bundle-plugin/test` | **159 pass / 0 fail** (baseline 154 / 0) |
| `bun run typecheck` | exit 0 |
| `bun run verify:comments` | PASS — 407 files, 34670 declarations |
| `node scripts/verify-dist-fresh.ts` | **29/29 targets fresh**, each rebuilt twice byte-identical (toolchain `bun 1.4.0`) |
| `bun run verify:rows` | ok — 33 row ids |
| `node scripts/verify-no-host-override.ts` | PASS — 0 id-targets collide with the 205 host-declared rows |
| `bun run verify:manifest` | PASS |
| `bun run verify:docs` | PASS — pairs=45 failed=0 violations=0 dead=0 |
| `node scripts/verify-pack-closure.ts --self-test` | PASS — 34/34 arms |
| `bun run test:qa` | all self-tests passed |
| `bun scripts/mpd-ext.ts --self-test` | PASS — 53 checks |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | PASS — negative controls 4/4 reddened |
| `node scripts/repin-vendor.ts --check` | GREEN — drift=0, problems=0, **no re-pin owed** |
| `node scripts/verify-vendor.ts` | upstream-identity half **obsolete by user policy** (see bounds); asset half GREEN |

**The two pre-existing reds are FIXED, and this is the wave's cleanest before/after marker.** At the
pre-wave revision both `panel-dag.test.ts` viewport arms failed; they are green now, and the fix was four
genuine defects rather than re-pointed assertions: a DOUBLE WINDOW that rendered a blank panel while the
footer still read `6/82`, a `rowIndex` that held the drawing's line instead of the column's row, a cursor
with no live authority (40 rapid `↓` presses focused the first task 40 times), and an auto-scroll that
overshot the band and scrolled the focused task out of view.

### Honest bounds — what this PR does NOT establish

1. **`verify:vendor`'s upstream-identity half is obsolete by user policy** (2026-10-06: *"以后不用同步
   oh-my-openagent，此plugin已和该插件脱钩，只作为早期参考存在"*). It therefore is NOT reported as an
   environment gap or a defect. The ASSET half still binds and is GREEN. That policy change is QUEUED as
   its own branch and PR (`.mpd/plans/vendor-decouple.md`) rather than folded in here.
2. **`docker/**/*.mts` is outside the root type program.** `tsconfig.json` includes `docker/**/*.ts`, which
   does not match `.mts`, so the drivers that produce this wave's most persuasive evidence are untypechecked.
   Measured: widening the include reddens `typecheck` on three `/tmp/mpd-fixture/*.mts` imports that exist
   only inside the capture container. Recorded, queued, not fixed here.
3. **The enable-keeper's residual, named in five places.** A user who removes ALL of our panel ids
   persistently leaves a list indistinguishable from a fresh profile's at the live-store level, so the set
   is re-added once per boot. Closing it needs the CONFIGURED value — a third host-internals contact — which
   §6 counts deliberately; deferred to its own change.
4. **`resolveTuiAdapter` is order-dependent.** The mounted `mpd-tui-adapter` row can be decorative for
   adapter-provided capabilities, because the consumer resolves the adapter ONCE and falls back to a
   row-private instance when the sibling apply order goes the other way. The keeper was made
   race-independent as a workaround; the architectural fix is queued. The `cordis.patch.yml` comment that
   claims laziness describes `createLazyTuiAdapter`, which the call site does not use.
5. **One arm was reformulated, not merely fixed.** The reviewer's W6 density bound (`widest chord <
   nodeHeight`) encoded reasoning that is WRONG — straight runs are emitted as one `L` by design, so a
   rank-skipping leg is legitimately one long chord, and containment rests on the segment test rather than
   on spacing. The arm now asserts the ordered invariant (no zero-length chord, over 666 chords) and
   reports the widest chord instead of pinning it.
6. **`evidence/tui/dag-port/verification/…/report.md` rides along** uncommitted from the stacked branch; it
   is that wave's own verification-report edit and is named here so the diff is not misread as this wave's.
7. The TUI scene's vertical `graphY` window is wired and typechecked but carries no dedicated arm.
8. **The 64-cell cap is a DECLARED taste boundary, not a measured optimum.** Above it the panel falls back
   to the rail (clause T9's safety net), so a board whose longest graph-safe label exceeds 64 cells gets
   the full-DAG rail rather than pannable boxes. The boundary is where "boxes plus pan" stops being better
   than "one line per task", and it is stated here so a reader can disagree with the number instead of
   having to discover it.
9. **One PTY finding is about the INSTRUMENT, not the product, and is reported as such.** The verifier's
   first `pty-fixed` read reported `cjkInDrawing=3` on rows like `│subject REQ · 冻结验收契约：│` — those
   are the PINNED DETAIL BODY's rows, inside the panel frame, swept into the C1 scan by a box-rule test.
   That is design-freeze risk #3 ("C1 is asserted over the wrong scope") arriving in the instrument rather
   than in the product. It split the region on the pin marker into DRAWING and DETAIL halves, scans C1 on
   the drawing only and reads C3 from the detail, and its 13 self-test arms still pass.

## 简体中文

### 改了什么，为什么

用户一口气提了两件事：WEB 依赖 DAG 的**连线**要按 mermaid 那种**曲线**优化；TUI 的 DAG 要加**双向滚动条**，
渲染向 [termaid](https://github.com/fasouto/termaid) 的流程图靠拢。外带一条硬约束——**两张图上都不许出现
任何中文字符**，而点击后的描述可以有。理由很具体：终端对 CJK 的对齐极不友好。

动代码之前先与用户敲定了六个决策（逐字答案见 `evidence/dag/dag-edges-scroll/requirements.md`），下面每一条
都对应其中一个。

**WEB（`packages/mpd-bundle-plugin/src/team-view.ts`）。** 连图层不再是绝对定位的 `<div>` 矩形，而是一个
`<svg>`，里面每条边一个 `<path data-mpd-curve>`，箭头是一个 `<polygon data-mpd-head data-mpd-tip>`。
**路由仍然在纯布局里算**——同样的 lane、同样的预留行、同样的盒锚点——曲线只是**产生矩形的那份 waypoint 列
表**的参数化，所以公布的展平折线**可证地描述了被画出的东西**。`data-mpd-route` 逐字节不变，仍是路由真值；
新增标记是 `data-mpd-curve`（`d`）与 `data-mpd-tip`（零宽矩形，`left` 即到达点在**布局坐标**下的 x）。几何
重新调过（`GEO.inset 4 → 12`），使声明的 6px 圆角不被夹掉：gutter 8px → **24px**，节点宽 160px → **144px**，
实际发出的圆角 2px → **6px**。

**TUI（`packages/mpd-tui-plugin/src/**`）。** 绘图获得**自然宽度**——按最宽的 graph-safe 标签定尺寸，而不是
硬压进面板——于是 `GraphView.width` 可以超过视口；再由唯一的单元格感知切片器（`sanitize.ts` 的 `sliceCells`
与 `graph.ts` 的 `sliceSpans`）切成**恰好等于视口宽**，且**绝不切开宽字形**。横轴**长在同一个 `PanelViewport`
句柄上**并复用同一个 `clampScroll` 区间——每轴一个偏移，不存在第二个滚动器。四个 legacy 布局入口
（`layoutBoxes`/`layoutRail`/`layoutList`/`layoutGraph`）签名与 fit-width 语义完全不变。渲染向 termaid 靠拢：
宽松的 **5 行盒**（含上下留白行）+ 按垂直预算回退的 **3 行压缩形**、在 `dag-theme.ts` 里**声明一次**的圆角
`╭ ╮ ╰ ╯`（`DAG_CHARS`）、`─ │ ├ ┤ ┬ ┴ ┼` 的连线与分叉，以及**尖端贴住依赖方顶边**的 `▼`。

**条款 R8（用户自己的收窄）。** 横向视窗**只属于 DAG 绘图本身**。面板头、图例、钉住的详情正文、成员行与页脚
一律按**整个面宽**渲染，既不横向移动也不被裁切。若按字面理解成"整页横向滚动"，正是这条裁定要防的缺陷。

**图上禁中文（两端）。** 每个界面一个 composer `graphSafeLabel(subject, ordinal)`，覆盖**所有把任务文本写进图
里**的位置：可打印 ASCII 片段用单个空格连接，若无可打印内容则回退 `#<序号>`。点击/钉住的详情正文与悬停提示
**原样保留**原始标题。

**契约修订。** 有两份现存文本禁止本波，所以本波第一件事就是修订它们：`docs/plan-webui-tui-i18n.md` §3 的
"plain absolutely-positioned divs, no SVG, no measuring pass" 被"drawn as an SVG path whose route is
computed in the pure layout — no DOM read, no measuring pass"取代（**幸存下来的禁令是"测量"**，不是 SVG）；
`evidence/tui/dag-port/requirements.md` 中"WEB DAG 本身不得修改"的 non-goal 标记为已被取代，因为用户明确
指示要改它。

**另一个独立缺陷，被发现并修复。** 修复用户另一条报障（TUI 侧栏只显示宿主内置项）时，修复车道用进程内探针
加**调用栈**复现了真因：宿主自己的 `dsh-tui` row 在我们注册追加之后约 **4.3 秒**重新应用自身配置
（`applySidePanelPanels(config.sidePanel?.panels)`，经 `Fiber._reload` 到达），把我们加的 id 全部丢掉。修法
是在 `mpd-tui-adapter-plugin` 里做**版本门控、有界**的补写，外加一条命令的耐用路线 `scripts/mpd-tui-panels.ts`。
补写**只要生效列表里出现我们的任意一个 id 就立刻停手**——所以它修得好全新 profile，却**永远不会推翻已经配置
过该列表的用户**。

### 实测证据

关键产物见英文部分的表格（同一批路径）。特别说明：**队长自己那份包含性检查是独立于两条车道的**——按定义手写的
线段-盒内部判定，跑 106 个公布采样点 → **0 次入侵**，并有正向对照（所有折线整体平移 40px）抓到 **91 次**，
所以那个 0 是**测出来的 0**，不是"永远不会红的仪器"。

### 跑过的门禁与实测结果

| 门禁 | 实测 |
|---|---|
| `bun test packages` | **1841 pass / 3 skip / 0 fail**，147 文件 |
| `bun test packages/mpd-tui-plugin/test` | **379 pass / 0 fail**（改动前基线 **332 / 2**） |
| `bun test packages/mpd-bundle-plugin/test` | **159 pass / 0 fail**（基线 154 / 0） |
| `bun run typecheck` | exit 0 |
| `bun run verify:comments` | PASS — 407 文件、34670 处声明 |
| `node scripts/verify-dist-fresh.ts` | **29/29 targets fresh**，每个重建两次逐字节一致（工具链 `bun 1.4.0`） |
| `bun run verify:rows` | ok — 33 个 row id |
| `node scripts/verify-no-host-override.ts` | PASS — 0 处与宿主 205 个 row 冲突 |
| `bun run verify:manifest` | PASS |
| `bun run verify:docs` | PASS — pairs=45 failed=0 violations=0 dead=0 |
| `node scripts/verify-pack-closure.ts --self-test` | PASS — 34/34 臂 |
| `bun run test:qa` | 全部自测通过 |
| `bun scripts/mpd-ext.ts --self-test` | PASS — 53 项检查 |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | PASS — 负控 4/4 变红 |
| `node scripts/repin-vendor.ts --check` | GREEN — drift=0, problems=0，**本波零重钉** |
| `node scripts/verify-vendor.ts` | 上游身份那一半**按用户政策已废止**（见边界）；资产那一半 GREEN |

**两条既存红灯已修好，这是本波最干净的 before/after 标记。** 改动前 `panel-dag.test.ts` 的两条视口臂都是红的，
现在绿了，而且修的是**四个真缺陷**而非改断言：一个**双重开窗**（按 PgDn 会渲染空白面板，页脚却仍显示 `6/82`）、
一个把"绘制行号"当成"列的行"的 `rowIndex`、一个**没有实时权威的光标**（连按 40 次 `↓` 只是把第一个任务聚焦
40 次）、以及一个越过边界、**把被聚焦任务滚出视野**的自动滚动。

### 诚实边界——这份 PR **不**主张的事

1. **`verify:vendor` 的上游身份那一半按用户政策已废止**（2026-10-06：「以后不用同步oh-my-openagent，此plugin
   已和该插件脱钩，只作为早期参考存在」）。因此它**不**被报告为环境缺口、也**不**被报告为缺陷。**资产那一半
   仍然绑定且为 GREEN**。该政策变更**排队为独立分支与 PR**（`.mpd/plans/vendor-decouple.md`），不并入本波。
2. **`docker/**/*.mts` 不在根类型程序内。** `tsconfig.json` 的 include 是 `docker/**/*.ts`，匹配不到 `.mts`，
   于是本波最具说服力的证据（抓取驱动）处于未类型检查状态。实测：扩大 include 会让 `typecheck` 因三处
   `/tmp/mpd-fixture/*.mts` 导入变红，而那些路径**只存在于抓取容器内**。已记录、已排队，**本波不修**。
3. **enable keeper 的残留，已在五处具名。** 若用户**持久删除我们的全部**面板 id，其列表在 live store 层与全新
   profile **不可区分**，于是每次启动会被补一次。根除需要读**配置值**——即第三个宿主内部接触面——而 §6 对这类
   接触面是**计数**的；已推迟到独立变更。
4. **`resolveTuiAdapter` 有顺序依赖。** 挂载的 `mpd-tui-adapter` row 对**适配器提供的能力**可能是装饰品，因为
   消费者**只解析一次**，兄弟 row 的 apply 顺序反过来时它会回退到行内私有实例。keeper 已做成**不依赖竞态**作为
   权宜；架构修法已排队。`cordis.patch.yml` 里声称"惰性"的那句注释描述的是 `createLazyTuiAdapter`，而调用点
   用的不是它。
5. **有一条臂是"被重构"而不是"被修好"。** 取证车道的 W6 密度界（`widest chord < nodeHeight`）编码的推理是**错的**
   ——直线段按设计整段只发一个 `L`，所以跨 rank 的腿本来就是一根长弦；包含性靠**线段测试**而非间距。该臂现在断言
   有序不变量（666 根弦无零长度）并把最宽弦**作为测量值报告**，而不是钉死。
6. **`evidence/tui/dag-port/verification/…/report.md` 是搭车提交的**——它来自被堆叠的那条分支、是该波自己验证报告的
   编辑，在这里点名，免得 diff 被误读成本波的工作。
7. TUI 场景的纵向 `graphY` 视窗已接线并通过类型检查，但**没有专门的臂**。
