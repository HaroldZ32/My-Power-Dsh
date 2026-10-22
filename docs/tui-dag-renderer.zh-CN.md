# DAG 渲染器：本波次仍是字符网格，自研渲染器推迟

[English](./tui-dag-renderer.md)

dsh-tui 各界面中 MPD 依赖 DAG 的**决策记录**。负责方：TUI 通道（`packages/mpd-tui-plugin`）。日期：2026-10-23。
输入契约：`.mpd/plans/watchdog-tui-panel.md`（“Also in this lane”）。状态：**已决定**——本波次 DAG 仍是字符网格；
自研渲染器推迟，重新开启的条件在 §5 明确列出。

## 1. 问题

MPD 侧栏页面中的 DAG（`panel.ts` → `panel-dag.ts` → `graph.ts`）是一张**字符网格**：每个节点、边、连接处与图例
单元格都是本 bundle 自己排布、经宿主的 `ui.Text` / `ui.Box` 绘制的 Unicode 字形。本记录要回答的是：是否应改用
终端图形路径——notcurses 或宿主自带的 `ui.Image` 原语——如果不是，究竟要先改变什么。

## 2. 评估过什么

### 2.1 notcurses —— 不可行

四条互相独立的理由，任意一条都足以否决：

1. **这里没有 Node/Bun 绑定。** notcurses 是 C 库；已安装的 profile 里**没有 notcurses 包**，也**没有 FFI
   运行时**（profile 中唯一命中 `ffi` 的是 `@types/node` 下的类型声明，它不携带运行时）。要用它就得自己
   引入一个原生依赖。
2. **安装时需要 C 工具链。** 发布的 bundle 刻意是**无构建脚本**的（`AGENTS.md` §8）：一条命令安装不得编译
   任何东西，而 pnpm 在没有审批通道时会拒绝依赖的构建脚本。
3. **它会独占 tty。** notcurses 自己驱动输出与输入，而宿主的 Ink reconciler 拥有帧、布局、按键分发以及
   面板的挂载/卸载生命周期。同一个终端两个主人不是接缝，而是一场由“谁最后写”决定的竞态。
4. **它没有渲染到缓冲区的 API。** 它的输出*就是*终端——没有“画进我的单元网格”的入口，因此宿主渲染器
   没有任何东西可以把一个面板合成出来。

这个结论是架构性的，不依赖基准测试：即使有一个完美的绑定，也无法在不取代宿主渲染器的情况下画进宿主的
面板里。

### 2.2 参考实现 `dsh-blender-plugin` —— 没有图形代码

本 bundle 在面板工作上一直参照的参考实现**完全不含图形代码**。它用的是宿主的 panel 接缝——一个由宿主自己的
reconciler 渲染的 React 组件——与本 bundle 的做法完全一致。因此它没有提供终端图形路径的先例，也没有可复制的
实测收益。

### 2.3 宿主的 `ui.Image` 路径 —— 有界、只接受位图、不可交互

宿主确实暴露了图像原语（`ui.Image`，读取自已安装的 dsh-tui **0.16.1** 类型声明）。它自己的契约就排除了 DAG：

| 属性（宿主自己的措辞/声明） | 对 DAG 的后果 |
|---|---|
| `TerminalImageSource = { data: Uint8Array, width, height }`，“immutable row-major sRGB pixels, four bytes per pixel in RGBA order” | 调用方必须提供**已解码的像素**。宿主**不导出解码器、也不导出光栅化器**：DAG 的位图只能由我们自己从图布局生成 RGBA 缓冲 |
| `children`：“Same-size terminal-cell fallback rendered when graphics are unavailable” | **单元格回退是强制的**——每个图像下面仍然画着字符网格，所以网格无法退役，只能重复 |
| `presentation: 'preview' \| 'transcript'`；“Default keeps Kitty only”；`TerminalImageProtocolName = 'kitty' \| 'sixel'` | 图形只在 Kitty/Sixel 终端上存在；其他终端显示回退 |
| “The component never emits protocol bytes itself. It contributes a normal Yoga leaf; the Ink host decides after layout…” | 图像是**静态叶子**。没有逐节点命中测试、没有单元格光标、没有按键焦点——DAG 的点击钉住、焦点移动与滚动都是图像无法承载的单元格手势 |
| 边界：最大边长 1024（预览 2048）、最大解码字节、最大帧字节、最大单元格（128×128 的单元框）与 64 个放置 | 即使能画，也只是一张固定尺寸的位图，装在宿主拥有的框里 |

因此图像只能是一张**不可交互、且下面必须压着网格的图画**。对一张价值在于*哪个节点被钉住、哪个任务被聚焦、
读者滚到哪里*的图来说，这严格弱于网格已经能做到的事。

## 3. 决定

1. **本波次 DAG 保持字符网格。** 它可交互、适配 28 列的侧栏底线、由宿主自己的 `ui.Text`/`ui.Box` 绘制，
   颜色也已经来自宿主主题键。
2. **自研渲染器推迟**，不是凭口味否决：§5 列出在重新开启这个问题之前必须存在的四件事。
3. **颜色契约已经是天然的对齐基线。** 任何未来的渲染器都必须产出与网格经宿主主题键表达的同样六种状态色
   （§4），这样两个界面不会在“失败”或“运行中”长什么样上产生分歧。
4. **本记录就是“本波次不做图形”这一主张的来源**，后来者不必再从工单里重新推导。

## 4. 颜色基线：WEB 色调

`packages/mpd-tui-plugin/src/dag-theme.ts` 带有 `DAG_TONE_WEB_HEX` —— Web 视图自己的 `TONE` 常量，
作为**来源**记录：TUI 里没有任何东西渲染十六进制色值，面板画的是宿主主题键，而保真度测试读取这些值，
证明六种状态与 Web 色调一一对应。未来的光栅化器必须原样采用这张表。

| 色调 | 十六进制 | 今天的宿主主题键 |
|---|---|---|
| `completed` | `#12a150` | `success` |
| `running` | `#4d6bfe` | `activity` |
| `failed` | `#e5484d` | `error` |
| `blocked` | `#e08700` | `warning` |
| `cancelled` | `#8a94a6` | `inactive` |
| `open` | `#5b6472` | `subtle` |
| `focus` | `#5b6472` | `accentShimmer` |
| `chain` | `#5b6472` | `accent` |
| `edge` | `#d8dde5` | `promptBorder` |
| `dim` | `#8a94a6` | `inactive` |

后四个是**绘制自身的**色调（Web 视图用不透明度与 CSS 变量表达它们，而不是状态名），所以它们与上面的状态
共用色值。

## 5. 出现渲染器之前必须改变什么

1. **一个光栅化器。** 图布局（`graph.ts`）产出的是单元格与 span，不是像素。渲染器需要一遍布局 → RGBA
   （字形光栅化或矢量重绘），还需要宿主并不暴露的字体度量。
2. **一套带真实回退的协议方案。** 只有 Kitty/Sixel，而单元格回退是强制的——所以网格无论如何都在，渲染器
   必须是它之上的严格改进。
3. **逐节点交互。** 图像原语是叶子。点击钉住、按键焦点与滚动无论如何都要重新投射到单元格上——那正是网格
   自己的模型。
4. **可测的收益。** 本波次的操作者需求（读到团队状态、看到暂停与事件、找到被钉住的任务）没有任何一项被
   字形绘制阻塞；渲染器必须展示出能抵消上述四项代价的收益。

## 6. 证据与边界

- **读取自已安装的宿主**：dsh-tui **0.16.1** 自己的类型声明
  （`lib/types/ink/components/Image.d.ts`、`lib/types/ink/terminal-image.d.ts`、
  `lib/types/ink/hooks/use-terminal-images.d.ts`）——上面的引文与边界表都出自它们，不是凭记忆复述。
- **读取自已安装的 profile**：没有 `notcurses` 包、没有 FFI 运行时（对 profile 的 `node_modules` 做过文件
  系统搜索）；唯一命中 `ffi` 的是一份类型声明。
- **未实测、如实声明为边界**：没有尝试 PTY 图形抓取，也没有声称任何性能数字。结论是架构性的（所有权、
  可安装性、回退与交互），因此不依赖截图。
- **既有字符网格证据**留在原记录处：`evidence/tui/dag-port/verification/pty/` 下的 DAG PTY 抓取与面板
  自己的测试套件（`packages/mpd-tui-plugin/test/panel-dag.test.ts`）都是网格证据，此处不再当作图形证据使用。
