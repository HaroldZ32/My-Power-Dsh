# Ready-to-paste Chinese mirror of `§6.4` (and its `§4.1` pointer)

`docs/tui.zh-CN.md` is **not** in t29's declared inScope (`dsh-plugin.json`,
`packages/mpd-bundle/cordis.patch.yml`, `presets/`, `evidence/tui/composition/`,
`scripts/install-profile.mjs`, `docs/tui.md`), and the dispatch instruction is "work only this task
and only its in-scope paths". The English half landed in `docs/tui.md`; this file carries the exact
Chinese text so the mirror is a paste, not an authoring task.

Insert the pointer right after the `compatible / compatible_degraded / waiting_authorization /
rejected / unknown` line in §4.1 (around `docs/tui.zh-CN.md:84`):

```markdown
本包中有一处注册刻意留在清单投影之外——`/mpd` 命令，它走的是宿主的 `commands` 服务（见 §6.4）。
```

Insert the new section after §6.3 (after the line ending with `（18 个技能）。`, around
`docs/tui.zh-CN.md:177`):

```markdown
### 6.4 `/mpd` 命令使用的是宿主未归属（unattributed）的 `commands` 服务

`packages/mpd-tui-plugin/src/commands.ts:53-60` 把 `/mpd` 注册到宿主的 `commands` 服务上——即宿主以
`commands.dsh/v1alpha1` 契约对外声明的那个面——而清单声明的是 `contributes.commands: []`。这两件事同时
为真：清单的 `x-mpd-tui-surfaces.whyNoContribution` 陈述的是更窄、也更精确的事实——本插件"没有通过
Command 能力注册任何 host Command"。由清单中介的 Command **贡献**面是另一条路径，它才需要贡献 id
（以及按宿主注册表 `registry/permissions-0.1.json`，`commands.invoke` 权限）。本包刻意把宿主的
`commands` 服务留在该投影之外、不声明任何贡献，因此 `contributes.commands: []` 是**真话，而不是遗漏**。

其后果是被测量并披露的，而不是被掩盖：宿主的效果台账把这次注册记为 `undeclared`，因为受中介
（`tuiPluginHost.registerCommand`）的路径需要一个已准入的组件身份，而准入按设计处于
`waiting_authorization`——这是 t10 的 F4 披露，见 `evidence/tui/review/t12/REVIEW.md:62` 与
`result.json:115`。`/mpd` 本身可用：实机通道渲染了该命令及其命令树，属于七个界面中已渲染的六个（第七个
由明确不声明第 10 条覆盖）。另一种读法——在清单里声明该命令——需要已授予的 `commands.invoke` 权限，以及
profile 安装的插件无法到达的准入路径（§6.1），因此不是本版本选择的读法。生态最终采用哪种读法，由交付报告
说明。
```

After pasting, `docs/tui.zh-CN.md` will satisfy t29's item 3 in both languages; the English half is
already verified by `doc-assertion.json` in this directory (`item3.docs/tui.md` = ok, and the
`item3.docs/tui.zh-CN.md` check is the one that currently reports the gap).
