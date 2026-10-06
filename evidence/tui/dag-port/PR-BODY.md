<!-- docs-parity: exempt process record — this is a PR body (bilingual pair inside ONE description), not a human-facing doc -->

# feat(tui): port the WEB dependency DAG to three independent TUI sidebar pages

## English

### What changed

The WEB dependency DAG is ported to the TUI as a native, adaptive surface, and the whole `mpd-tui`
layer is restyled onto one visual system. Three independent sidebar pages now register through the
dsh-tui 0.13.0 panel seam:

| slug | title | icon | order | minColumns |
|---|---|---|---|---|
| `team` | `MPD` | — | 10 | 28 |
| `dag` | `MPD DAG` | `◈` | 11 | 28 |
| `workmate` | `MPD workmate` | `◆` | 12 | 28 |

All three ask the host for **28** — the host's own floor — because `PanelHost.js` replaces a page's
BODY with a `panel-too-narrow` notice when the column is narrower than the descriptor's `minColumns`
(`const tooNarrow = def.minColumns !== undefined && width < def.minColumns`). Asking for more creates a
band of terminal widths where the sidebar opens, the tab is present, and the user is shown a refusal
instead of a graph. Narrow-viewport readability is the page's own layout decision (boxes → rail → list).

### The defects this wave fixes, with measurements

**1. A dependency DAG that silently collapsed to one column.** On the live board, tasks with
prerequisites drew in the SAME column as tasks with none, with no edges and no warning. Three stacked
causes: a staged plan's `blocked_by` is stored verbatim while `resolveBlocker` returns an unmatched
reference unchanged; `taskDepths` then filters unresolvable references away (`byId.has(candidate)`), so
every task becomes a root and every depth 0; and the view trusted that 0
(`Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0`) instead of deriving. Now **rank is
derived from the graph on both planes**, unresolved references are surfaced rather than dropped, and
the producer reports the failure at WRITE time. Measured on identical input:
`distinctRanks [0] / links 0` → **`[0,1,2,3,4] / links 14`**.

**2. Illegible WEB edges.** A rank-skipping edge routed its riser through the MIDDLE of an intermediate
column. Measured on the real 5-rank board: the `T2→T7` edge was `riser[255,25 1x52]` with **3 of 3 runs
crossing a box**; after the fix the hops travel in real gutters (`riser[165,77 1x104]`,
`cross1[165,181 171x1]`) with **0 interior overlaps across 66 runs × 12 boxes**, `laneOverflow=0`.

**3. A CJK node that lost its right border.** `cursor += cellWidth(char)` advanced two cells per wide
glyph while writing one grid slot, so the intervening slot stayed background. Measured on `cjk-1` line 1:
**33 codepoints / 34 cells / `endsWith│=false`** → **28 / 34 / `endsWith│=true`**. Every rendered line is
now cell-exact at 48/64/80/120/200.

**4. A DAG rail that overflowed its frame and wrapped.** 7 tasks drew **14 rows**, with one-word
fragments (`│ v`, `│visual-reviewer`, `│ r`) scattered down the panel. After budgeting every row against
the frame INTERIOR (`panelContentWidth(cols) = max(1, cols - 2)`): **7 rows, one per task, assignee
inline**. Before/after panes are kept at
`evidence/tui/dag-port/verification/pty/{interim-368005,frozen}/w120/`.

**5. A panel that was never visible, and a command that claimed it opened.** The host's tab strip paints
only ids in the enable CSV, which the host's own config mirror overwrites after registration
(`enablePanelIdInStore` then `applySidePanelPanels(value.sidePanel?.panels ?? …)`); the sidebar also
starts closed. `tuiPanels.open(id)` returns true on DELIVERY while `useSidePanel` drops the request for
an un-enabled id — a false green. Root-caused, measured both ways on a real PTY, and the sentence is
now honest.

### Gates run, with observed results

| gate | observed |
|---|---|
| `bun test ./packages` | 1789 pass / 3 skip / **2 fail** |
| `./node_modules/.bin/tsgo --noEmit -p tsconfig.json` | **0 errors** |
| `bun run verify:comments` | **PASS** (405 files, 33872 declarations) |
| `bun run verify:docs` | **PASS** (pairs=45, failed=0, links=439, dead=0) |
| `node scripts/verify-dist-fresh.ts` | **ok 29/29 fresh** |
| `bun run verify:manifest` | **PASS** |
| `node scripts/verify-no-host-override.ts` | **PASS** (0 of 0 collide with 205 host ids) |
| `node scripts/verify-pack-closure.ts` | **PASS** (drift-expected notes only) |
| `skills/dsh-qa/scripts/preset-conformance.ts --self-test` | **PASS** (32 rows, parity 26/25, controls 4/4) |
| `bun run test:qa` | **all self-tests passed** |
| `bun run verify:vendor` | **NOT RUNNABLE** — no `oh-my-openagent` checkout / `MPD_UPSTREAM_ROOT` on this machine |
| `node scripts/docker-e2e.ts --mode source --require-docker` | see below |

### Honest bounds — what this wave does NOT claim

- **The 2 red tests are deliberate.** They are the recorded signature of an UNFIXED defect: an
  unbounded `PgDn` run accumulates the committed offset across renders, so the window can clamp to zero
  rows. Diagnosed, bounded (reachable only after a long run; not visible on the first screen), and left
  red on purpose with one arm asserting the property that will go green when it is fixed. **The
  scrollbar is NOT claimed to be flawless.**
- **Visual verdicts are bound to a build.** The final PTY capture is anchored to the frozen revision
  `packages/mpd-tui-plugin/dist/index.js` sha256 `c8b87a32dafde0c9…` (368228 B) and
  `packages/mpd-bundle-plugin/client.js` sha256 `2fbd0e26da6e898c…` (640774 B). Every earlier rendering
  verdict in this wave was taken against a 21:34 build that PREDATED the new pages — which produced a
  false "the page renders nothing" finding — so **a PTY capture is evidence about a BUILD, never about a
  source tree.**
- **One reported defect was WITHDRAWN as an instrument artefact.** "The frame's right border lands on the
  wrong column" was phantom: the sidebar had been sliced out by CODE POINT while a neighbouring column
  carried CJK, drifting one cell per wide glyph. Re-measured cell-accurately, the frame is a rectangle on
  every row of both builds (borders at cells 81 and 117). It is recorded as a RETRACTION, not deleted —
  and it is the wave's most transferable lesson: **the code-point-versus-cell error appeared twice, once
  inside the product (defect 3) and once inside the instrument measuring it, and the instrument fails
  silently in the direction of reporting defects that are not there.**
- **Not verified:** R8 (animation — a static capture cannot show motion), R11 (a pinned-task detail body
  was never captured), R16 (Docker), the producer-side `unresolvedBlockers` field reaching readers,
  `verify:vendor` (not runnable here).
- **Not ported from WEB:** hover, pixel geometry, CSS ellipsis, `overflow:auto`, native tooltips, DOM
  reads and `fetch` polling. The WEB DAG is the reference.
- **Post-wave follow-ups, recorded not done:** `packages/mpd-bundle-plugin/client.js` has **no freshness
  gate** (it is built by `node scripts/build-mpd-client.ts`, not by the dist build) — the same
  stale-artifact class that caused the false finding; and `skills/dsh-qa/scripts/tui-panels.ts` is
  **store-blind** (`tuiPanels=rendered` while no pane shows the tab), which is how the invisibility
  survived a whole wave.

### Evidence

`evidence/tui/dag-port/` — `requirements.md` (the frozen contract and its eight amendments),
`freeze/FROZEN-REVISION.md`, and per-lane records under `dag-layout/`, `web-dag/`, `graph-rank/`,
`panel-surface/`, `tui-visuals/`, `seam-guard/`, `data-plane/`, `verification/`, `visual/`, `docs/`,
plus `team-feature-test/` (the team-build defects found while running this wave).

---

## 简体中文

### 变更内容

把 WEB 版的依赖 DAG 作为**原生、自适应**的表面移植到 TUI，并把整个 `mpd-tui` 层统一到**一套视觉系统**。
侧栏现在通过 dsh-tui 0.13.0 的面板接缝注册**三个独立页面**：

| slug | 标题 | 图标 | 顺序 | minColumns |
|---|---|---|---|---|
| `team` | `MPD` | — | 10 | 28 |
| `dag` | `MPD DAG` | `◈` | 11 | 28 |
| `workmate` | `MPD workmate` | `◆` | 12 | 28 |

三个页面都向宿主只要 **28**（宿主自己的下限）：`PanelHost.js` 里
`const tooNarrow = def.minColumns !== undefined && width < def.minColumns` —— **描述符要得比宿主给的多，
宿主不会隐藏面板，而是把它的内容替换成一整屏"面板太窄"的提示**。于是存在一段终端宽度：侧栏能开、
标签在、用户看到的却是一句拒绝。窄屏可读性是**页面自己的布局决定**（boxes → rail → list）。

### 本波次修复的缺陷（附实测）

**1. 一个会静默塌成一列的依赖 DAG。** 线上板子上，有前置依赖的任务和没有的**画在同一列**，零条边，
全程无警告。三层原因叠加：建队计划的 `blocked_by` 被原样存储，而 `resolveBlocker` 认不出来就原样返回；
`taskDepths` 又用 `byId.has(candidate)` 把解析不出的引用**静默过滤掉**，于是每个任务都成了根节点、
每个 depth 都是 0；而视图**信任**这个 0。现在**两个平面都从依赖图推导 rank**，解析不到的引用会被
**显式报出**而不是丢弃，生产侧在**写入时**就报告失败。同一输入实测：
`distinctRanks [0] / links 0` → **`[0,1,2,3,4] / links 14`**。

**2. 看不清的 WEB 连线。** 跨列依赖的竖线被放在**中间列的正中央**。真实 5 列板子实测：`T2→T7` 边为
`riser[255,25 1x52]`，**3 条线段全部穿过任务框**；修复后逐列跳走真实列间间隙
（`riser[165,77 1x104]`、`cross1[165,181 171x1]`），**整图 66 条线段 × 12 个框，内部重叠 0 处**。

**3. CJK 节点丢失右边框。** `cursor += cellWidth(char)` 遇到宽字符推进 2 格却只写 1 个槽位，中间那格
留成了背景。`cjk-1` 第 1 行实测：**33 码点 / 34 格 / `endsWith│=false`** → **28 / 34 / `endsWith│=true`**。

**4. 超出边框并折行的 DAG rail。** 7 个任务画了 **14 行**，中间夹着单词碎片（`│ v`、`│visual-reviewer`、`│ r`）。
改为所有行都按**框内宽度**（`panelContentWidth(cols) = max(1, cols - 2)`）预算后：**7 行，一任务一行，
负责人内联**。前后对照截图保留在 `evidence/tui/dag-port/verification/pty/{interim-368005,frozen}/w120/`。

**5. 一个从来不可见的面板，和一句声称"已打开"的命令。** 标签栏只画启用名单里的 id，而宿主自己的
配置镜像会在注册之后覆盖它（`enablePanelIdInStore` 之后又被
`applySidePanelPanels(value.sidePanel?.panels ?? …)` 覆写）；侧栏本身默认还是关的。
`tuiPanels.open(id)` 只要**投递**成功就返回 true，而 `useSidePanel` 会丢弃未启用 id 的请求 —— **假绿灯**。
已定位根因、在真实 PTY 上双向实测，并且把那句话改成诚实的表述。

### 门禁与实测结果

| 门禁 | 观测结果 |
|---|---|
| `bun test ./packages` | 1789 pass / 3 skip / **2 fail** |
| `./node_modules/.bin/tsgo --noEmit -p tsconfig.json` | **0 错误** |
| `bun run verify:comments` | **PASS**（405 文件、33872 声明） |
| `bun run verify:docs` | **PASS**（pairs=45、failed=0、links=439、dead=0） |
| `node scripts/verify-dist-fresh.ts` | **ok 29/29 fresh** |
| `bun run verify:manifest` | **PASS** |
| `node scripts/verify-no-host-override.ts` | **PASS**（0/0 碰撞 205 个宿主 id） |
| `node scripts/verify-pack-closure.ts` | **PASS**（仅有 drift-expected 提示） |
| `preset-conformance.ts --self-test` | **PASS**（32 行、parity 26/25、负控 4/4） |
| `bun run test:qa` | **all self-tests passed** |
| `bun run verify:vendor` | **无法运行** —— 本机没有 `oh-my-openagent` 检出 / `MPD_UPSTREAM_ROOT` |
| `node scripts/docker-e2e.ts --mode source --require-docker` | 见下 |

### 诚实的边界 —— 本波次**不**声称的东西

- **那 2 个红测试是故意的。** 它们是一个**未修复**缺陷的记录签名：连续 `PgDn` 会在跨渲染累加已提交的
  offset，窗口可能被夹到 0 行。已诊断、有边界（只有长按翻页才会到，首屏看不到），**故意留红**，其中一条
  断言的是"修好后会变绿"的那个属性。**滚动条不声称完美。**
- **视觉结论绑定到构建。** 最终 PTY 截图锚定在冻结版本
  `packages/mpd-tui-plugin/dist/index.js` sha256 `c8b87a32dafde0c9…`（368228 B）与
  `packages/mpd-bundle-plugin/client.js` sha256 `2fbd0e26da6e898c…`（640774 B）上。本波次**更早**的所有
  渲染结论都取自一个 **早于新页面的 21:34 构建** —— 并因此产生过一条"页面渲染为空"的假发现。所以：
  **一次 PTY 截图是关于某个构建的证据，从来不是关于源码树的证据。**
- **有一条上报的缺陷被撤回，因为它是仪器伪影。** "边框落在错误的列上"是幻象：切侧栏时用了**码点切片**，
  而相邻列带 CJK，**每遇到一个宽字符就漂一格**。按单元格重测，两个构建的框在每一行都是矩形
  （边框在第 81 与 117 格）。它以**撤回**的形式记录，而不是删掉 —— 因为它是本波次最有价值的教训：
  **"码点 vs 单元格"这个错误出现了两次，一次在产品里（缺陷 3），一次在测量产品的仪器里；而仪器的失败
  方向是"报出不存在的缺陷"。**
- **未验证**：R8（动画，静态截图证明不了运动）、R11（未捕获到 pin 详情体）、R16（Docker）、
  生产侧 `unresolvedBlockers` 字段到达读取方、`verify:vendor`（本机不可运行）。
- **未从 WEB 移植**：hover、像素几何、CSS 省略号、`overflow:auto`、原生 tooltip、DOM 读取与 `fetch` 轮询。
  WEB 版是参照物。
- **记录但未执行的后续项**：`packages/mpd-bundle-plugin/client.js` **没有新鲜度门禁**（它由
  `node scripts/build-mpd-client.ts` 构建，不走 dist 构建）—— 正是造成那条假发现的过期产物同类；
  以及 `skills/dsh-qa/scripts/tui-panels.ts` 是**存储源盲的**（`tuiPanels=rendered` 而没有任何 pane
  显示该标签），这是"不可见"能藏住整整一波的原因。

### 证据

`evidence/tui/dag-port/` —— `requirements.md`（冻结契约与八条修正）、`freeze/FROZEN-REVISION.md`，
以及各 lane 记录：`dag-layout/`、`web-dag/`、`graph-rank/`、`panel-surface/`、`tui-visuals/`、
`seam-guard/`、`data-plane/`、`verification/`、`visual/`、`docs/`，另有 `team-feature-test/`
（跑这一波时发现的建队功能缺陷）。
