11:   - 一个 `@mpd-dsh/mpd` 注册，其 factory 把 workmate 库贡献为它自己的 **DSH-better-sidebar** Tab（`mpd-workmate`，order 90，`single: true`），它通过 `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/init` 读取和创建 workmate，并通过 `POST /plugins/mpd-workmate/{rename,delete}` 重命名/删除 —— 按 reason 编码的拒绝分支处理（`invalid-name` / `confirm-required` / `unknown` / `collision` / `in-use`（带阻塞团队列表）），删除是显式两步（确认 → 归档，或输入名称后彻底删除），文案 zh/en。base 只按**功能名**寻址：该 Tab 渲染名称，绝不渲染名册 id（id 属内部，workmate 路由也不再携带它们）。它还保留了那个隐藏 `/agent-teams` 命令结果的 `conversation.chat.commandview` 空行（仅供仍把该结果路由到该插槽的宿主使用）。两个页面都**没有**浮动回退：只要有 mpd client 源注册了 `agent-teams-activity`、`conversation.chat.node`、`shell.overlay` 或 `sidebar.footer.action`，`scripts/build-mpd-client.ts` 就会让构建失败。
25:## 嵌套分组：子单元画成帧框
31:- **盒子就是它的内部，递归布局。** 每个帧框自己的条目按扁平绘制的同一套规则放置——按服务下发的列分列、
32:  列内按 id 排序、在盒子之上预留一条跨越带给跳列的边——然后盒子按这个内部加上帧框自身的留白定尺寸，因此它
33:  发布的矩形（`data-mpd-group="<id>,<left>,<top>,<width>,<height>"`）**包住**它内部的卡片与嵌套盒子。嵌套
37:  "任意两条线不共用一像素"的承诺原样扩展到每个内部。
38:- **一块画布、绝对坐标。** 嵌套分支把每张卡、每条线、每个帧框都写进画布自己的像素坐标
40:  内部会在**其盒子被放置的那个原点**重新规划，因此绘制出的路径与测试用来证明"不进入盒子"的折线是同一条曲线。
43:- **声明边界。** 单个帧框**内部**的环状依赖本构建不路由（扁平路径会把它画在左侧），几何把它的见证记入
45:  悬停光晕覆盖**根帧**的卡片（内部卡片保持自己的色调）。
